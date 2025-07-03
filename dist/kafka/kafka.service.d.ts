import { OnModuleInit } from '@nestjs/common';
export declare class KafkaService implements OnModuleInit {
    private kafka;
    private producer;
    private consumer;
    private isConnected;
    private readonly logger;
    constructor();
    onModuleInit(): Promise<void>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    produce(topic: string, message: any): Promise<import("kafkajs").RecordMetadata[] | undefined>;
    consume(topics: string[], callback: (topic: string, message: any) => void): Promise<void>;
}
