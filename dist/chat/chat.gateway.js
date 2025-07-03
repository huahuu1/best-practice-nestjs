"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ChatGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const kafka_service_1 = require("../kafka/kafka.service");
const common_1 = require("@nestjs/common");
let ChatGateway = ChatGateway_1 = class ChatGateway {
    kafkaService;
    logger = new common_1.Logger(ChatGateway_1.name);
    processedMessages = new Set();
    connectedClients = new Map();
    validOrders = new Map();
    server;
    constructor(kafkaService) {
        this.kafkaService = kafkaService;
    }
    async afterInit() {
        this.logger.log('Chat Gateway initialized');
        try {
            await this.kafkaService.consume(['restaurant-orders', 'restaurant-chat', 'order-status-updates'], (topic, message) => {
                this.logger.log(`Received message from Kafka topic ${topic}: ${JSON.stringify(message)}`);
                if (topic === 'restaurant-orders') {
                    if (this.validateOrder(message)) {
                        this.validOrders.set(message.id, message);
                        this.server.to(`table-${message.tableId}`).emit('orderUpdate', message);
                        this.server.to('kitchen-staff').emit('orderUpdate', message);
                        this.logger.log(`Valid order update broadcast: ${message.id} for table ${message.tableId}`);
                    }
                    else {
                        this.logger.warn(`Invalid order rejected: ${JSON.stringify(message)}`);
                    }
                }
                else if (topic === 'order-status-updates') {
                    if (message && message.order_id && message.status) {
                        const orderId = message.order_id;
                        const existingOrder = this.validOrders.get(orderId);
                        if (existingOrder) {
                            existingOrder.status = message.status;
                            this.validOrders.set(orderId, existingOrder);
                            this.server.to(`table-${existingOrder.tableId}`).emit('orderUpdate', existingOrder);
                            this.server.to('kitchen-staff').emit('orderUpdate', existingOrder);
                            this.logger.log(`Order status updated: ${orderId} to ${message.status}`);
                        }
                        else {
                            this.logger.warn(`Received status update for unknown order: ${orderId}`);
                        }
                    }
                    else {
                        this.logger.warn(`Invalid order status update: ${JSON.stringify(message)}`);
                    }
                }
                else if (topic === 'restaurant-chat') {
                    if (message.tableId) {
                        const messageId = `${message.sender}-${message.message}-${message.timestamp}`;
                        if (!this.processedMessages.has(messageId)) {
                            this.processedMessages.add(messageId);
                            if (this.processedMessages.size > 1000) {
                                const messagesArray = Array.from(this.processedMessages);
                                this.processedMessages = new Set(messagesArray.slice(-500));
                            }
                            if (message.clientId && this.connectedClients.has(message.clientId)) {
                                const clientInfo = this.connectedClients.get(message.clientId);
                                if (clientInfo) {
                                    const originatingSocketId = clientInfo.socketId;
                                    this.server.to(`table-${message.tableId}`).except(originatingSocketId).emit('chatMessage', message);
                                    if (!message.isFromKitchen) {
                                        this.server.to('kitchen-staff').emit('chatMessage', message);
                                    }
                                }
                                else {
                                    this.server.to(`table-${message.tableId}`).emit('chatMessage', message);
                                    this.server.to('kitchen-staff').emit('chatMessage', message);
                                }
                            }
                            else {
                                this.server.to(`table-${message.tableId}`).emit('chatMessage', message);
                                this.server.to('kitchen-staff').emit('chatMessage', message);
                            }
                        }
                    }
                }
            });
        }
        catch (error) {
            this.logger.warn('Failed to connect to Kafka, chat service will work without Kafka integration');
        }
        setInterval(() => {
            const now = new Date();
            for (const [clientId, info] of this.connectedClients.entries()) {
                if (now.getTime() - info.lastActive.getTime() > 30 * 60 * 1000) {
                    this.connectedClients.delete(clientId);
                }
            }
        }, 5 * 60 * 1000);
    }
    validateOrder(order) {
        if (!order || !order.id || !order.tableId || !Array.isArray(order.items)) {
            this.logger.warn(`Invalid order missing required fields: ${JSON.stringify(order)}`);
            return false;
        }
        if (typeof order.id !== 'string' || !order.id.startsWith('ORD-')) {
            this.logger.warn(`Invalid order ID format: ${order.id}`);
            return false;
        }
        if (!order.tableId || isNaN(Number(order.tableId))) {
            this.logger.warn(`Invalid table ID: ${order.tableId}`);
            return false;
        }
        if (!order.items.every(item => item && item.id && item.name &&
            typeof item.quantity === 'number' &&
            typeof item.price === 'number')) {
            this.logger.warn(`Invalid order items: ${JSON.stringify(order.items)}`);
            return false;
        }
        const validStatuses = ['new', 'preparing', 'ready', 'delivered', 'paid',
            'received', 'processing', 'completed'];
        if (!validStatuses.includes(order.status)) {
            this.logger.warn(`Invalid order status: ${order.status}`);
            return false;
        }
        if (order.total !== undefined && (isNaN(Number(order.total)) || Number(order.total) < 0)) {
            this.logger.warn(`Invalid order total: ${order.total}`);
            return false;
        }
        this.logger.log(`Order validated successfully: ${order.id}`);
        return true;
    }
    handleConnection(client) {
        this.logger.log(`Client connected: ${client.id}`);
        const clientId = client.handshake.query.clientId;
        if (clientId) {
            if (this.connectedClients.has(clientId)) {
                const existingInfo = this.connectedClients.get(clientId);
                if (existingInfo) {
                    existingInfo.socketId = client.id;
                    existingInfo.lastActive = new Date();
                    this.connectedClients.set(clientId, existingInfo);
                    this.logger.log(`Reconnected client ${clientId} with new socket ${client.id}`);
                }
            }
        }
    }
    handleDisconnect(client) {
        this.logger.log(`Client disconnected: ${client.id}`);
        for (const [clientId, info] of this.connectedClients.entries()) {
            if (info.socketId === client.id) {
                info.lastActive = new Date();
                this.connectedClients.set(clientId, info);
                break;
            }
        }
    }
    handleJoinRoom(client, data) {
        const clientId = data.clientId || client.handshake.query.clientId;
        if (!clientId) {
            this.logger.warn(`Client ${client.id} attempted to join room without clientId`);
            return { event: 'error', data: { message: 'Client ID is required' } };
        }
        this.connectedClients.set(clientId, {
            socketId: client.id,
            isKitchenStaff: !!data.isKitchenStaff,
            tableId: data.tableId,
            clientId,
            lastActive: new Date()
        });
        if (data.isKitchenStaff) {
            client.join('kitchen-staff');
            this.logger.log(`Kitchen staff ${client.id} joined kitchen room`);
            const orders = Array.from(this.validOrders.values());
            client.emit('allOrders', { orders });
            return { event: 'joinedRoom', data: { roomName: 'kitchen-staff' } };
        }
        else if (data.tableId) {
            const roomName = `table-${data.tableId}`;
            client.join(roomName);
            this.logger.log(`Client ${client.id} joined room: ${roomName}`);
            const tableOrders = Array.from(this.validOrders.values())
                .filter(order => order.tableId == data.tableId);
            if (tableOrders.length > 0) {
                client.emit('tableOrders', { tableId: data.tableId, orders: tableOrders });
            }
            return { event: 'joinedRoom', data: { roomName } };
        }
        return { event: 'error', data: { message: 'Invalid room join request' } };
    }
    handleLeaveRoom(client, data) {
        const clientId = data.clientId || client.handshake.query.clientId;
        if (clientId && this.connectedClients.has(clientId)) {
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
        }
        else if (data.tableId) {
            const roomName = `table-${data.tableId}`;
            client.leave(roomName);
            this.logger.log(`Client ${client.id} left room: ${roomName}`);
            return { event: 'leftRoom', data: { roomName } };
        }
        return { event: 'error', data: { message: 'Invalid room leave request' } };
    }
    async handleMessage(client, data) {
        const { tableId, message, sender, isFromKitchen } = data;
        const roomName = `table-${tableId}`;
        const clientId = data.clientId || client.handshake.query.clientId;
        const timestamp = data.timestamp || new Date().toISOString();
        const chatMessage = {
            tableId,
            message,
            sender,
            isFromKitchen: !!isFromKitchen,
            timestamp,
            clientId
        };
        const messageId = `${sender}-${message}-${timestamp}`;
        if (!this.processedMessages.has(messageId)) {
            this.processedMessages.add(messageId);
            if (clientId && this.connectedClients.has(clientId)) {
                const info = this.connectedClients.get(clientId);
                if (info) {
                    info.lastActive = new Date();
                    this.connectedClients.set(clientId, info);
                }
            }
            await this.kafkaService.produce('restaurant-chat', chatMessage);
            if (isFromKitchen) {
                this.server.to(roomName).emit('chatMessage', chatMessage);
                this.logger.log(`Kitchen staff message sent to table ${tableId}: ${message}`);
            }
            else {
                this.server.to('kitchen-staff').emit('chatMessage', chatMessage);
                this.logger.log(`Customer message sent to kitchen from table ${tableId}: ${message}`);
            }
            client.emit('chatMessage', chatMessage);
            this.logger.log(`Message sent to Kafka from ${sender}: ${message}`);
        }
        else {
            this.logger.log(`Duplicate message detected and ignored: ${messageId}`);
        }
        return { event: 'messageSent', data: chatMessage };
    }
    async handleGetOrders(client, data) {
        this.logger.log(`Fetching orders for table ${data.tableId}`);
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
    async handleGetAllOrders(client) {
        this.logger.log('Fetching all orders for kitchen staff');
        const orders = Array.from(this.validOrders.values());
        return {
            event: 'allOrders',
            data: { orders }
        };
    }
};
exports.ChatGateway = ChatGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], ChatGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('joinRoom'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleJoinRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leaveRoom'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], ChatGateway.prototype, "handleLeaveRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('sendMessage'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleMessage", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('getOrdersForTable'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleGetOrders", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('getAllOrders'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", Promise)
], ChatGateway.prototype, "handleGetAllOrders", null);
exports.ChatGateway = ChatGateway = ChatGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            credentials: true,
        },
    }),
    __metadata("design:paramtypes", [kafka_service_1.KafkaService])
], ChatGateway);
//# sourceMappingURL=chat.gateway.js.map