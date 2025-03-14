import type { Context } from 'koishi';
import { lastMessageIds, logger, type Config } from './index';
import WebSocket from 'ws';
import { findChannelId, parseCoreMessage, wrapPassive } from './message';
import { SessionEventManagerMap } from './event-manager';

export class GsuidCoreClient {
    reconnectInterval = 5000;
    isDispose = false;
    ws!: WebSocket;

    public createWs(ctx: Context, config: Config): void {
        const url = `${config.isWss ? 'wss' : 'ws'}://${config.host}:${config.port}/${config.wsPath}/${config.botId}`;
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            logger.info(`与[gsuid-core]成功连接! Bot_ID: ${config.botId}`);
        });

        this.ws.on('error', (err) => {
            logger.error(`与[gsuid-core]连接时发生错误: ${err}`);
        });

        this.ws.on('close', (err) => {
            logger.error(`与[gsuid-core]连接断开: ${err}`);
            if (!this.isDispose) {
                setTimeout(() => {
                    logger.info(`自动连接core服务器失败...${this.reconnectInterval / 1000}秒后重新连接...`);
                    this.createWs(ctx, config);
                }, this.reconnectInterval);
            } else {
                logger.info('已经重载实例或停用插件，当前实例不再自动重连');
            }
        });

        this.ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (config.dev) logger.info(data.toString());

            if (message.target_id == null) {
                message.content.forEach((element) => {
                    logger.info(`收到[gsuid-core]日志消息: ${element.data}`);
                });
            } else {
                if (config.dev) logger.info(message);
                const bot = ctx.bots[`${message.bot_id}:${message.bot_self_id}`];
                if (bot == null) return;
                let parsed = parseCoreMessage(message, config);
                let msgId = message.msg_id;


                // 如果配置启用了 useLastMessageId，并且 msgId 为空，则使用存储的 ID
                if (config.useLastMessageId && !msgId) {
                    const key = `${message.target_id}`;
                    msgId = lastMessageIds.get(key);
                }

                if (config.figureSupport) {
                    if (msgId && config.passive) {
                        parsed = wrapPassive(parsed, msgId);
                    }
                    if (msgId && SessionEventManagerMap.get(msgId)) {
                        SessionEventManagerMap.get(msgId)?.triggerEvent({ message: parsed, id: msgId });
                    } else {
                        if (message.target_type === 'group') {
                            bot.sendMessage(message.target_id, parsed, message.target_id);
                        } else if (message.target_type === 'direct') {
                            bot.sendPrivateMessage(message.target_id, parsed);
                        }
                        if (message.target_type === 'channel') {
                            const id = findChannelId(message) ?? message.target_id;
                            bot.sendMessage(id, parsed, message.target_id);
                        }
                    }
                } else {
                    parsed.flat().forEach(async (element) => {
                        const p = msgId && config.passive ? wrapPassive([element], msgId) : [element];
                        if (config.dev) logger.info(msgId);
                        if (msgId && SessionEventManagerMap.get(msgId)) {
                            SessionEventManagerMap.get(msgId)?.triggerEvent({ message: parsed, id: msgId });
                        } else {
                            if (message.target_type === 'group') {
                                bot.sendMessage(message.target_id, p, message.target_id);
                            } else if (message.target_type === 'direct') {
                                bot.sendPrivateMessage(message.target_id, p);
                                /*await bot.sendPrivateMessage(message.target_id, {
                                    content: element,
                                    msgId
                                });*/
                            } else if (message.target_type === 'channel') {
                                const id = findChannelId(message) ?? message.target_id;
                                bot.sendMessage(id, p, message.target_id);
                            }
                        }
                    });
                }
            }
        });
    }
}