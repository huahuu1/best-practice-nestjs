"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
async function bootstrap() {
    const logger = new common_1.Logger('Bootstrap');
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    });
    const port = process.env.PORT ?? 3001;
    const host = process.env.HOST ?? 'localhost';
    await app.listen(port, host);
    logger.log(`Restaurant Chat Service is running on http://${host}:${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map