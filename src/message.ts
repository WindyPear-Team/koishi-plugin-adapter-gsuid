import { type Context, Session, h, segment } from 'koishi';
import { Config, logger } from '.';
import { mkdirSync, writeFileSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

interface Message {
    type?: string;
    data?: any;
}
interface ToCoreMessage {
    bot_id: string | 'bot';
    bot_self_id: string;
    msg_id: string;
    user_type: string | 'group' | 'direct' | 'channel' | 'sub_channel';
    group_id?: string;
    user_id?: string;
    user_pm: number;
    content: Message[];
}

interface FromCoreMessage {
    bot_id: string | 'bot';
    bot_self_id: string;
    msg_id: string;
    target_type: string | 'group' | 'direct' | 'channel' | 'sub_channel';
    target_id: string;
    content: Message[];
}

const genUserType = (session: Session): string => {
    if (session.subsubtype) {
        if (session.subtype === 'group') {
            return 'group';
        } else if (session.subtype === 'private') {
            return 'direct';
        } else if (session.subtype === 'channel') {
            return 'channel';
        } else if (session.subtype === 'sub_channel') {
            return 'sub_channel';
        } else if (session?.event?.channel != null) {
            return 'channel';
        } else {
            return 'unknown';
        }
    } else {
        //cc数据变化
        if (session?.event?.channel) {
            if (session?.event?.channel.type === 0) return 'channel';
            if (session?.event?.channel.type === 1) return 'direct';
            if (session?.event?.channel.type != null) return 'channel';
        } else {
            return 'unknown';
        }
    }
};

const genUserPermission = async (session: Session, ctx: Context): Promise<number> => {
    if (ctx.database) {
        const user = await ctx.database.getUser(session.platform, session.userId);
        if (user?.authority >= 4) {
            return 6 - user.authority > 0 ? 6 - user.authority : 1;
        }
    }
    if (session.channelId?.startsWith('private:')) {
        if (session.author?.roles?.includes('admin')) {
            return 3;
        }
        if (session.author?.roles?.includes('owner')) {
            return 2;
        }
        return 6;
    } else {
        return 6;
    }
};

const genContent = async (session: Session): Promise<Message[]> => {
    if (session.elements == null) return [];
    const m: Message[] = [];
    for (const item of session.elements) {
        if (item.type === 'at') {
            m.push({
                type: item.type,
                data: item.attrs.id,
            });
        }

        if (item.type === 'img') {
            m.push({
                type: item.type,
                data: item.attrs.src,
            });
        }

        if (item.type === 'image') {
            m.push({
                type: item.type,
                data: item.attrs.url,
            });
        }

        if (item.type === 'text') {
            m.push({
                type: item.type,
                data: item.attrs.content,
            });
        }

        if (item.type === 'quote') {
            m.push({
                type: 'reply',
                data: item.attrs.id,
            });
        }

        if (item.type === 'file') {
            try {
                const res = await session.app.http.file(item.attrs.url);
                const b = Buffer.from(res.data);
                const content = `${item.attrs.name}|${b.toString('base64')}`;
                m.push({
                    type: item.type,
                    data: content,
                });
            } catch (error) {
                logger.error(`下载文件失败: ${error}`);
            }
        }
    }
    return m;
};

export const genToCoreMessage = async (session: Session, ctx: Context): Promise<ToCoreMessage> => {
    return {
        bot_id: session.platform,
        bot_self_id: session.selfId,
        msg_id: session.event.message.id,
        user_type: genUserType(session),
        group_id: session.channelId?.startsWith('private:') ? null : session.channelId,
        user_id: session.userId,
        user_pm: await genUserPermission(session, ctx),
        content: await genContent(session),
    };
};

export const parseMessage = (message: Message, messageId: string, config: Config) => {
    if (message.type === 'text') return segment.text(message.data);
    if (message.type === 'image') {
        if (message.data.startsWith('link://')) {
            const [_, url] = message.data.split('link://');
            if (config.imgType === 'img') {
                return h('img', { src: url });
            } else {
                return h('image', { url, src: url });
            }
        }

        if (message.data.startsWith('base64://')) {
            const base64Data = message.data.replace('base64://', '');
            const buffer = Buffer.from(base64Data, 'base64');
            const hash = createHash('sha1').update(buffer).digest('hex');
            const fileName = `${hash.slice(0, 8)}_${Date.now()}.png`;
            const filePath = `./data/assets/${fileName}`;

            mkdirSync('./data/assets', { recursive: true });
            writeFileSync(filePath, buffer);
            const koiurl = config.koishiUrl.replace(/\/$/, '')
            const fileUrl = `${koiurl}/files/${fileName}`;
            if (config.imgType === 'img') {
                return h('img', { src: fileUrl });
            } else {
                return h('image', { url: fileUrl, src: fileUrl });
            }
        }

        if (config.imgType === 'img') {
            return h('img', { src: message.data });
        } else {
            return h('image', { url: message.data, src: message.data });
        }
    }

    if (message.type === 'at') return segment.at(message.data);
    if (message.type === 'reply') return h('', {}, [h('quote', { id: messageId }), segment.text(message.data)]);
    if (message.type === 'file') {
        const [name, file] = message.data.split('|');
        const id = randomUUID();
        mkdirSync(`./data`, { recursive: true });
        writeFileSync(`./data/${id}`, file, 'base64');
        const location = resolve(join('.', 'data'), id);
        return h('custom-file', { name, location });
    }

    if (message.type === 'node') {
        if (config.figureSupport) {
            const result = h('figure');
            message.data.forEach((item) => {
                const attrs = {
                    nickname: '小助手',
                };
                result.children.push(h('message', attrs, parseMessage(item, messageId, config)));
            });
            return result;
        }
        return message.data.map((i) => parseMessage(i, messageId, config));
    }
    throw new Error(`Unknown message type: ${message.type}`);
};
/**
 * parse从core传来的消息
 */
export const parseCoreMessage = (message: FromCoreMessage, config: Config): segment[] => {
    const segments: segment[] = [];
    for (const item of message.content) {
        try {
            segments.push(parseMessage(item, message.msg_id, config));
        } catch (e) {
            logger.error(e.message);
        }
    }
    return segments;
};

export const wrapPassive = (segments: segment[], messageId: string): segment[] => {
    return [h('passive', { messageId }), ...segments];
};

/**
 * 查询group分组中的id
 */
export const findChannelId = (message: FromCoreMessage): string | null => {
    const group = message.content.find((item) => item.type === 'group');
    return group?.data;
};
