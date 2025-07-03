export const kafkaConfig = {
  clientId: 'restaurant-chat-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  groupId: 'chat-consumer-group',
}; 