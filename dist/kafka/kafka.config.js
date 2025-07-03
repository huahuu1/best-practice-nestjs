"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.kafkaConfig = void 0;
exports.kafkaConfig = {
    clientId: 'restaurant-chat-service',
    brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
    groupId: 'chat-consumer-group',
};
//# sourceMappingURL=kafka.config.js.map