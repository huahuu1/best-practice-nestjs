import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { KafkaService } from '../kafka/kafka.service';
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
export declare class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    private readonly kafkaService;
    private readonly logger;
    private processedMessages;
    private connectedClients;
    private validOrders;
    server: Server;
    constructor(kafkaService: KafkaService);
    afterInit(): Promise<void>;
    private validateOrder;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleJoinRoom(client: Socket, data: {
        tableId?: number | string;
        isKitchenStaff?: boolean;
        clientId: string;
    }): {
        event: string;
        data: {
            message: string;
            roomName?: undefined;
        };
    } | {
        event: string;
        data: {
            roomName: string;
            message?: undefined;
        };
    };
    handleLeaveRoom(client: Socket, data: {
        tableId?: number | string;
        isKitchenStaff?: boolean;
        clientId: string;
    }): {
        event: string;
        data: {
            roomName: string;
            message?: undefined;
        };
    } | {
        event: string;
        data: {
            message: string;
            roomName?: undefined;
        };
    };
    handleMessage(client: Socket, data: {
        tableId: number | string;
        message: string;
        sender: string;
        isFromKitchen?: boolean;
        timestamp?: string;
        clientId?: string;
    }): Promise<{
        event: string;
        data: {
            tableId: string | number;
            message: string;
            sender: string;
            isFromKitchen: boolean;
            timestamp: string;
            clientId: string;
        };
    }>;
    handleGetOrders(client: Socket, data: {
        tableId: number | string;
    }): Promise<{
        event: string;
        data: {
            tableId: string | number;
            orders: Order[];
        };
    }>;
    handleGetAllOrders(client: Socket): Promise<{
        event: string;
        data: {
            orders: Order[];
        };
    }>;
}
export {};
