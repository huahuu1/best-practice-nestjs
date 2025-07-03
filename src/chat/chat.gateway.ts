import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage, 
  OnGatewayConnection, 
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { KafkaService } from '../kafka/kafka.service';
import { Logger } from '@nestjs/common';

interface ClientInfo {
  socketId: string;
  isKitchenStaff: boolean;
  tableId?: string | number;
  clientId: string;
  lastActive: Date;
}

interface OrderItem {
  id: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  tableId: string | number;
  items: OrderItem[];
  status: 'new' | 'preparing' | 'ready' | 'delivered' | 'paid';
  createdAt: string;
  updatedAt: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);
  private processedMessages = new Set<string>();
  private connectedClients = new Map<string, ClientInfo>(); // Map clientId -> ClientInfo
  private validOrders = new Map<string, Order>(); // Map orderId -> Order
  
  @WebSocketServer()
  server: Server;

  constructor(private readonly kafkaService: KafkaService) {}

  async afterInit() {
    this.logger.log('Chat Gateway initialized');
    
    try {
      // Try to subscribe to Kafka topics, but don't block if it fails
      await this.kafkaService.consume(['restaurant-orders', 'restaurant-chat', 'order-status-updates'], (topic, message) => {
        this.logger.log(`Received message from Kafka topic ${topic}: ${JSON.stringify(message)}`);
        
        if (topic === 'restaurant-orders') {
          // Validate order before broadcasting
          if (this.validateOrder(message)) {
            // Store valid order
            this.validOrders.set(message.id, message);
            
            // Only send order updates to the relevant table and kitchen staff
            this.server.to(`table-${message.tableId}`).emit('orderUpdate', message);
            this.server.to('kitchen-staff').emit('orderUpdate', message);
            
            this.logger.log(`Valid order update broadcast: ${message.id} for table ${message.tableId}`);
          } else {
            this.logger.warn(`Invalid order rejected: ${JSON.stringify(message)}`);
          }
        } else if (topic === 'order-status-updates') {
          // Handle order status updates from Laravel backend
          if (message && message.order_id && message.status) {
            // Find the order in our valid orders map
            const orderId = message.order_id;
            const existingOrder = this.validOrders.get(orderId);
            
            if (existingOrder) {
              // Update the order status
              existingOrder.status = message.status;
              this.validOrders.set(orderId, existingOrder);
              
              // Broadcast the updated order
              this.server.to(`table-${existingOrder.tableId}`).emit('orderUpdate', existingOrder);
              this.server.to('kitchen-staff').emit('orderUpdate', existingOrder);
              
              this.logger.log(`Order status updated: ${orderId} to ${message.status}`);
            } else {
              this.logger.warn(`Received status update for unknown order: ${orderId}`);
            }
          } else {
            this.logger.warn(`Invalid order status update: ${JSON.stringify(message)}`);
          }
        } else if (topic === 'restaurant-chat') {
          // Broadcast chat messages to the appropriate room AND to kitchen staff
          if (message.tableId) {
            // Create a message identifier to prevent duplicates
            const messageId = `${message.sender}-${message.message}-${message.timestamp}`;
            
            // Only process if we haven't seen this message before
            if (!this.processedMessages.has(messageId)) {
              this.processedMessages.add(messageId);
              
              // Limit the size of the set to prevent memory leaks
              if (this.processedMessages.size > 1000) {
                // Create a new set with just the last 500 items
                const messagesArray = Array.from(this.processedMessages);
                this.processedMessages = new Set(messagesArray.slice(-500));
              }
              
              // Skip if this message came from the same client (avoid echo)
              if (message.clientId && this.connectedClients.has(message.clientId)) {
                // Skip sending to the originating client
                const clientInfo = this.connectedClients.get(message.clientId);
                if (clientInfo) {
                  const originatingSocketId = clientInfo.socketId;
                  
                  // Send to specific table room, excluding the originating client
                  this.server.to(`table-${message.tableId}`).except(originatingSocketId).emit('chatMessage', message);
                  
                  // Also send to kitchen staff, excluding the originating client if it's a kitchen staff
                  if (!message.isFromKitchen) {
                    this.server.to('kitchen-staff').emit('chatMessage', message);
                  }
                } else {
                  // Normal broadcast if client info is missing
                  this.server.to(`table-${message.tableId}`).emit('chatMessage', message);
                  this.server.to('kitchen-staff').emit('chatMessage', message);
                }
              } else {
                // Normal broadcast if we don't have client ID info
                this.server.to(`table-${message.tableId}`).emit('chatMessage', message);
                this.server.to('kitchen-staff').emit('chatMessage', message);
              }
            }
          }
        }
      });
    } catch (error) {
      this.logger.warn('Failed to connect to Kafka, chat service will work without Kafka integration');
    }
    
    // Cleanup old client connections every 5 minutes
    setInterval(() => {
      const now = new Date();
      for (const [clientId, info] of this.connectedClients.entries()) {
        // Remove clients that haven't been active for more than 30 minutes
        if (now.getTime() - info.lastActive.getTime() > 30 * 60 * 1000) {
          this.connectedClients.delete(clientId);
        }
      }
    }, 5 * 60 * 1000);
  }

  // Validate if an order is legitimate
  private validateOrder(order: any): boolean {
    // Check if order has required fields
    if (!order || !order.id || !order.tableId || !Array.isArray(order.items)) {
      this.logger.warn(`Invalid order missing required fields: ${JSON.stringify(order)}`);
      return false;
    }
    
    // Check if order ID follows expected format (ORD-XXXXXXXXX)
    if (typeof order.id !== 'string' || !order.id.startsWith('ORD-')) {
      this.logger.warn(`Invalid order ID format: ${order.id}`);
      return false;
    }
    
    // Check if tableId is valid
    if (!order.tableId || isNaN(Number(order.tableId))) {
      this.logger.warn(`Invalid table ID: ${order.tableId}`);
      return false;
    }
    
    // Check if order items are valid
    if (!order.items.every(item => 
      item && item.id && item.name && 
      typeof item.quantity === 'number' && 
      typeof item.price === 'number'
    )) {
      this.logger.warn(`Invalid order items: ${JSON.stringify(order.items)}`);
      return false;
    }
    
    // Check if order status is valid
    const validStatuses = ['new', 'preparing', 'ready', 'delivered', 'paid', 
                          'received', 'processing', 'completed'];
    if (!validStatuses.includes(order.status)) {
      this.logger.warn(`Invalid order status: ${order.status}`);
      return false;
    }
    
    // Additional validation for order total
    if (order.total !== undefined && (isNaN(Number(order.total)) || Number(order.total) < 0)) {
      this.logger.warn(`Invalid order total: ${order.total}`);
      return false;
    }
    
    this.logger.log(`Order validated successfully: ${order.id}`);
    return true;
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    const clientId = client.handshake.query.clientId as string;
    
    if (clientId) {
      // Check if this client already has a connection
      if (this.connectedClients.has(clientId)) {
        const existingInfo = this.connectedClients.get(clientId);
        
        // Update the socket ID if existingInfo exists
        if (existingInfo) {
          existingInfo.socketId = client.id;
          existingInfo.lastActive = new Date();
          this.connectedClients.set(clientId, existingInfo);
          
          this.logger.log(`Reconnected client ${clientId} with new socket ${client.id}`);
        }
      }
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    
    // Find and update the client record
    for (const [clientId, info] of this.connectedClients.entries()) {
      if (info.socketId === client.id) {
        // Just mark as disconnected but keep the record for potential reconnection
        info.lastActive = new Date();
        this.connectedClients.set(clientId, info);
        break;
      }
    }
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @ConnectedSocket() client: Socket, 
    @MessageBody() data: { tableId?: number | string; isKitchenStaff?: boolean; clientId: string }
  ) {
    const clientId = data.clientId || client.handshake.query.clientId as string;
    
    if (!clientId) {
      this.logger.warn(`Client ${client.id} attempted to join room without clientId`);
      return { event: 'error', data: { message: 'Client ID is required' } };
    }
    
    // Store client information
    this.connectedClients.set(clientId, {
      socketId: client.id,
      isKitchenStaff: !!data.isKitchenStaff,
      tableId: data.tableId,
      clientId,
      lastActive: new Date()
    });
    
    if (data.isKitchenStaff) {
      // Kitchen staff joins the kitchen room
      client.join('kitchen-staff');
      this.logger.log(`Kitchen staff ${client.id} joined kitchen room`);
      
      // Send all valid orders to kitchen staff
      const orders = Array.from(this.validOrders.values());
      client.emit('allOrders', { orders });
      
      return { event: 'joinedRoom', data: { roomName: 'kitchen-staff' } };
    } else if (data.tableId) {
      // Regular customer joins a table room
      const roomName = `table-${data.tableId}`;
      client.join(roomName);
      this.logger.log(`Client ${client.id} joined room: ${roomName}`);
      
      // Send table-specific orders
      const tableOrders = Array.from(this.validOrders.values())
        .filter(order => order.tableId == data.tableId);
      
      if (tableOrders.length > 0) {
        client.emit('tableOrders', { tableId: data.tableId, orders: tableOrders });
      }
      
      return { event: 'joinedRoom', data: { roomName } };
    }
    
    return { event: 'error', data: { message: 'Invalid room join request' } };
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket, 
    @MessageBody() data: { tableId?: number | string; isKitchenStaff?: boolean; clientId: string }
  ) {
    const clientId = data.clientId || client.handshake.query.clientId as string;
    
    if (clientId && this.connectedClients.has(clientId)) {
      // Update last active timestamp
      const info = this.connectedClients.get(clientId);
      if (info) {
        info.lastActive = new Date();
        this.connectedClients.set(clientId, info);
      }
    }
    
    if (data.isKitchenStaff) {
      client.leave('kitchen-staff');
      this.logger.log(`Kitchen staff ${client.id} left kitchen room`);
      return { event: 'leftRoom', data: { roomName: 'kitchen-staff' } };
    } else if (data.tableId) {
      const roomName = `table-${data.tableId}`;
      client.leave(roomName);
      this.logger.log(`Client ${client.id} left room: ${roomName}`);
      return { event: 'leftRoom', data: { roomName } };
    }
    
    return { event: 'error', data: { message: 'Invalid room leave request' } };
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @ConnectedSocket() client: Socket, 
    @MessageBody() data: { 
      tableId: number | string; 
      message: string; 
      sender: string; 
      isFromKitchen?: boolean; 
      timestamp?: string;
      clientId?: string;
    }
  ) {
    const { tableId, message, sender, isFromKitchen } = data;
    const roomName = `table-${tableId}`;
    const clientId = data.clientId || client.handshake.query.clientId as string;
    
    // Ensure we have a timestamp
    const timestamp = data.timestamp || new Date().toISOString();
    
    const chatMessage = {
      tableId,
      message,
      sender,
      isFromKitchen: !!isFromKitchen,
      timestamp,
      clientId
    };

    // Create a message identifier
    const messageId = `${sender}-${message}-${timestamp}`;
    
    // Only process if we haven't seen this message before
    if (!this.processedMessages.has(messageId)) {
      this.processedMessages.add(messageId);
      
      // Update client's last active timestamp
      if (clientId && this.connectedClients.has(clientId)) {
        const info = this.connectedClients.get(clientId);
        if (info) {
          info.lastActive = new Date();
          this.connectedClients.set(clientId, info);
        }
      }
      
      // Send message to Kafka
      await this.kafkaService.produce('restaurant-chat', chatMessage);
      
      // Emit directly to sockets for immediate feedback
      if (isFromKitchen) {
        // If from kitchen, send to the specific table room
        this.server.to(roomName).emit('chatMessage', chatMessage);
        this.logger.log(`Kitchen staff message sent to table ${tableId}: ${message}`);
      } else {
        // If from customer, send to kitchen staff
        this.server.to('kitchen-staff').emit('chatMessage', chatMessage);
        this.logger.log(`Customer message sent to kitchen from table ${tableId}: ${message}`);
      }
      
      // Add message to sender's socket to show their own message
      client.emit('chatMessage', chatMessage);
      
      this.logger.log(`Message sent to Kafka from ${sender}: ${message}`);
    } else {
      this.logger.log(`Duplicate message detected and ignored: ${messageId}`);
    }
    
    return { event: 'messageSent', data: chatMessage };
  }
  
  @SubscribeMessage('getOrdersForTable')
  async handleGetOrders(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { tableId: number | string }
  ) {
    this.logger.log(`Fetching orders for table ${data.tableId}`);
    
    // Filter orders for the specific table
    const tableOrders = Array.from(this.validOrders.values())
      .filter(order => order.tableId == data.tableId);
    
    return { 
      event: 'tableOrders', 
      data: { 
        tableId: data.tableId,
        orders: tableOrders
      } 
    };
  }
  
  @SubscribeMessage('getAllOrders')
  async handleGetAllOrders(@ConnectedSocket() client: Socket) {
    this.logger.log('Fetching all orders for kitchen staff');
    
    // Get all orders for kitchen staff
    const orders = Array.from(this.validOrders.values());
    
    return {
      event: 'allOrders',
      data: { orders }
    };
  }
} 