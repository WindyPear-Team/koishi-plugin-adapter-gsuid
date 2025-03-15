import { Context, Schema, Logger } from 'koishi';
import { GsuidCoreClient } from './client';
import { genToCoreMessage } from './message';
import { DataService } from '@koishijs/plugin-console';
import { createCustomFile } from './custom-file';
import { resolve } from 'path';
import { SessionEventManager, SessionEventManagerMap } from './event-manager';
export const reusable = true;
export const inject = ['database'];
export const name = 'adapter-gsuid';
export const logger = new Logger(name);
export const lastMessageIds = new Map<string, string>();

export interface Config {
    isWss: boolean;
    isHttps: boolean;
    botId: string;
    host: string;
    port: number;
    wsPath: string;
    httpPath: string;
    dev: boolean;
    figureSupport: boolean;
    imgType: 'image' | 'img';
    passive: boolean;
    useLastMessageId: boolean; // 新增配置项
    koishiUrl: string;
}

declare module '@koishijs/plugin-console' {
    namespace Console {
        interface Services {
            ['gscore-custom']: any;
        }
    }
}

export const Config: Schema<Config> = Schema.object({
    isWss: Schema.boolean().default(false).description('是否使用 wss'),
    isHttps: Schema.boolean().default(false).description('是否使用 https'),
    botId: Schema.string().default('koishi').description('机器人 ID'),
    host: Schema.string().default('localhost').description('主机地址'),
    port: Schema.number().default(8765).description('端口'),
    wsPath: Schema.string().default('ws').description('WebSocket 路径'),
    httpPath: Schema.string().default('genshinuid').description('HTTP 路径'),
    dev: Schema.boolean().default(false).description('是否启用调试输出'),
    figureSupport: Schema.boolean()
        .default(true)
        .description('兼容项：是否支持合并转发，如果当前适配器不支持，请设置为 FALSE'),
    imgType: Schema.union(['image', 'img'])
        .default('img')
        .description('兼容项：图片消息元素类型，新版本使用 img，旧版本使用 image'),
    passive: Schema.boolean()
        .default(true)
        .description('兼容项：是否启用 passive 消息元素包裹，用于获取消息上下文'),
    useLastMessageId: Schema.boolean()
        .default(false)
        .description('如果连接的那端不会返回 messageId，是否使用该用户在该群的最后一条消息 ID'),
    koishiUrl: Schema.string()
        .default('http://localhost:5140/')
        .description('Koishi 的 HTTP 访问地址'),
});

export function apply(ctx: Context, config: Config) {
    
        class GSCOREProvider extends DataService<string[]> {
        constructor(ctx: Context) {
            super(ctx, 'gscore-custom');
        }

        async get() {
            return [config.host, config.port.toString(), config.isHttps ? 'https:' : 'http:', config.httpPath];
        }
    }
    ctx.plugin(GSCOREProvider);
    ctx.inject(['console'], (ctx) => {
        ctx.console.addEntry({
            dev: resolve(__dirname, '../client/index.ts'),
            prod: resolve(__dirname, '../dist'),
        });
    });
    const client = new GsuidCoreClient();
    createCustomFile(ctx);

    ctx.on('ready', () => {
        client.createWs(ctx, config);
    });

    ctx.on('message', async (session) => {
        if (config.dev) {
            session.elements.forEach(logger.info);
            logger.info(session);
        }

        const message = await genToCoreMessage(session, ctx);

        // 发送消息
        client.ws.send(Buffer.from(JSON.stringify(message)));

        // 记录 messageId
        if (session.event.message.id) {
            if (!session.isDirect) {
                const key = `${session.guildId}`;
                lastMessageIds.set(key, session.event.message.id);
            } else {
                const key = `${session.userId}`;
                lastMessageIds.set(key, session.event.message.id);
            }
            new SessionEventManager(session, message.msg_id);
        }
    });

    ctx.on('dispose', () => {
        client.isDispose = true;
        client.ws.close();
    });
}