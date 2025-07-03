import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Consumer, Kafka, Producer } from 'kafkajs';
import { kafkaConfig } from './kafka.config';

@Injectable()
export class KafkaService implements OnModuleInit {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private isConnected = false;
  private readonly logger = new Logger(KafkaService.name);

  constructor() {
    try {
      this.kafka = new Kafka({
        clientId: kafkaConfig.clientId,
        brokers: kafkaConfig.brokers,
      });

      this.producer = this.kafka.producer();
      this.consumer = this.kafka.consumer({ 
        groupId: kafkaConfig.groupId 
      });
    } catch (error) {
      this.logger.error('Failed to initialize Kafka client', error);
    }
  }

  async onModuleInit() {
    try {
      await this.connect();
    } catch (error) {
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
    } catch (error) {
      this.isConnected = false;
      this.logger.error('Failed to connect to Kafka', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.isConnected) {
        if (this.producer) await this.producer.disconnect();
        if (this.consumer) await this.consumer.disconnect();
        this.isConnected = false;
      }
    } catch (error) {
      this.logger.error('Failed to disconnect from Kafka', error);
    }
  }

  async produce(topic: string, message: any) {
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
    } catch (error) {
      this.logger.error(`Failed to produce message to topic ${topic}`, error);
    }
  }

  async consume(topics: string[], callback: (topic: string, message: any) => void) {
    if (!this.isConnected || !this.consumer) {
      this.logger.warn(`Skipping message consumption from topics ${topics.join(', ')} - Kafka not connected`);
      return;
    }
    
    try {
      await Promise.all(
        topics.map((topic) => this.consumer.subscribe({ topic, fromBeginning: false }))
      );

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const value = message.value ? JSON.parse(message.value.toString()) : {};
            callback(topic, value);
          } catch (error) {
            this.logger.error(`Failed to process message from topic ${topic}`, error);
          }
        },
      });
    } catch (error) {
      this.logger.error(`Failed to consume messages from topics ${topics.join(', ')}`, error);
    }
  }
} 