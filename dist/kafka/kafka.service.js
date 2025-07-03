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
var KafkaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafkaService = void 0;
const common_1 = require("@nestjs/common");
const kafkajs_1 = require("kafkajs");
const kafka_config_1 = require("./kafka.config");
let KafkaService = KafkaService_1 = class KafkaService {
    kafka;
    producer;
    consumer;
    isConnected = false;
    logger = new common_1.Logger(KafkaService_1.name);
    constructor() {
        try {
            this.kafka = new kafkajs_1.Kafka({
                clientId: kafka_config_1.kafkaConfig.clientId,
                brokers: kafka_config_1.kafkaConfig.brokers,
            });
            this.producer = this.kafka.producer();
            this.consumer = this.kafka.consumer({
                groupId: kafka_config_1.kafkaConfig.groupId
            });
        }
        catch (error) {
            this.logger.error('Failed to initialize Kafka client', error);
        }
    }
    async onModuleInit() {
        try {
            await this.connect();
        }
        catch (error) {
            this.logger.warn('Failed to connect to Kafka, chat service will work without Kafka integration');
        }
    }
    async connect() {
        try {
            if (!this.producer || !this.consumer) {
                this.logger.warn('Kafka client not initialized, skipping connection');
                return;
            }
            await this.producer.connect();
            await this.consumer.connect();
            this.isConnected = true;
            this.logger.log('Successfully connected to Kafka');
        }
        catch (error) {
            this.isConnected = false;
            this.logger.error('Failed to connect to Kafka', error);
            throw error;
        }
    }
    async disconnect() {
        try {
            if (this.isConnected) {
                if (this.producer)
                    await this.producer.disconnect();
                if (this.consumer)
                    await this.consumer.disconnect();
                this.isConnected = false;
            }
        }
        catch (error) {
            this.logger.error('Failed to disconnect from Kafka', error);
        }
    }
    async produce(topic, message) {
        if (!this.isConnected || !this.producer) {
            this.logger.warn(`Skipping message production to topic ${topic} - Kafka not connected`);
            return;
        }
        try {
            return await this.producer.send({
                topic,
                messages: [
                    {
                        value: JSON.stringify(message),
                        timestamp: Date.now().toString(),
                    },
                ],
            });
        }
        catch (error) {
            this.logger.error(`Failed to produce message to topic ${topic}`, error);
        }
    }
    async consume(topics, callback) {
        if (!this.isConnected || !this.consumer) {
            this.logger.warn(`Skipping message consumption from topics ${topics.join(', ')} - Kafka not connected`);
            return;
        }
        try {
            await Promise.all(topics.map((topic) => this.consumer.subscribe({ topic, fromBeginning: false })));
            await this.consumer.run({
                eachMessage: async ({ topic, partition, message }) => {
                    try {
                        const value = message.value ? JSON.parse(message.value.toString()) : {};
                        callback(topic, value);
                    }
                    catch (error) {
                        this.logger.error(`Failed to process message from topic ${topic}`, error);
                    }
                },
            });
        }
        catch (error) {
            this.logger.error(`Failed to consume messages from topics ${topics.join(', ')}`, error);
        }
    }
};
exports.KafkaService = KafkaService;
exports.KafkaService = KafkaService = KafkaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], KafkaService);
//# sourceMappingURL=kafka.service.js.map