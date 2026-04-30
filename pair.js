const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const fetch = require('node-fetch');
const pino = require('pino');
const vm = require('vm');
const yts = require("yt-search");
const cheerio = require('cheerio');
const BASE_URL = 'https://noobs-api.top';
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
const { tmpdir } = require('os');
const { sms, downloadMediaMessage } = require("./msg");
const { PassThrough } = require('stream');
const ffmpeg = require('fluent-ffmpeg');
const webp = require('node-webpmux');
const { writeFile } = require('fs/promises');
const FileType = require('file-type');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateWAMessageContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    selfMode: false,
    antidelete: true,
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_READ: 'false',
    AUTO_LIKE_EMOJI: ['💋', '😶', '💫', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐭'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: '',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg',
    NEWSLETTER_JID: '120363420261263259@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '254762673217',
    OWNER_NAME: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs🎀',
    BOT_FOOTER: 'ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBuCXcAO7RByB99ce3R'
};

let autoReadEnabled = false;
global.autoReadPM = false;
const groupWelcomeSettings = new Map();
global.welcomeSettings = groupWelcomeSettings;

const ANTICALL_SETTINGS_PATH = './anti-call-settings.json';
const DEFAULT_ANTICALL_SETTINGS = {
    rejectCalls: true,
    blockCaller: false,
    notifyAdmin: true,
    autoReply: "🚫 I don't accept calls. Please send a text message instead.",
    blockedUsers: []
};

function loadAnticallSettings() {
    try {
        if (fs.existsSync(ANTICALL_SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(ANTICALL_SETTINGS_PATH, 'utf8'));
        }
    } catch {}
    return { ...DEFAULT_ANTICALL_SETTINGS };
}

function saveAnticallSettings(s) {
    try {
        fs.writeFileSync(ANTICALL_SETTINGS_PATH, JSON.stringify(s, null, 2));
    } catch {}
}

const anticallSettings = loadAnticallSettings();
const messageStore = new Map();
const CONFIG_PATH = './antidelete.json';
const TEMP_MEDIA_DIR = './tmp';

if (!fs.existsSync(TEMP_MEDIA_DIR)) {
    fs.mkdirSync(TEMP_MEDIA_DIR, { recursive: true });
}

const getFolderSizeInMB = (folderPath) => {
    try {
        const files = fs.readdirSync(folderPath);
        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(folderPath, file);
            if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
            }
        }
        return totalSize / (1024 * 1024);
    } catch (err) {
        console.error('Error getting folder size:', err);
        return 0;
    }
};

const cleanTempFolderIfLarge = () => {
    try {
        const sizeMB = getFolderSizeInMB(TEMP_MEDIA_DIR);
        if (sizeMB > 200) {
            const files = fs.readdirSync(TEMP_MEDIA_DIR);
            for (const file of files) {
                const filePath = path.join(TEMP_MEDIA_DIR, file);
                fs.unlinkSync(filePath);
            }
            console.log('Temp folder cleaned, size was:', sizeMB.toFixed(2), 'MB');
        }
    } catch (err) {
        console.error('Temp cleanup error:', err);
    }
};

setInterval(cleanTempFolderIfLarge, 60 * 1000);

function loadAntideleteConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) return { enabled: true };
        return JSON.parse(fs.readFileSync(CONFIG_PATH));
    } catch {
        return { enabled: true };
    }
}

function saveAntideleteConfig(configData) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2));
        return true;
    } catch (err) {
        console.error('Config save error:', err);
        return false;
    }
}

async function storeMessage(sock, message) {
    try {
        const antideleteConfig = loadAntideleteConfig();
        if (!antideleteConfig.enabled) return;

        if (!message.key?.id) return;

        const messageId = message.key.id;
        let content = '';
        let mediaType = '';
        let mediaPath = '';
        let isViewOnce = false;
        const sender = message.key.participant || message.key.remoteJid;

        const viewOnceContainer = message.message?.viewOnceMessageV2?.message || message.message?.viewOnceMessage?.message;
        if (viewOnceContainer) {
            if (viewOnceContainer.imageMessage) {
                mediaType = 'image';
                content = viewOnceContainer.imageMessage.caption || '';
                const buffer = await downloadContentFromMessage(viewOnceContainer.imageMessage, 'image');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
                await writeFile(mediaPath, buffer);
                isViewOnce = true;
            } else if (viewOnceContainer.videoMessage) {
                mediaType = 'video';
                content = viewOnceContainer.videoMessage.caption || '';
                const buffer = await downloadContentFromMessage(viewOnceContainer.videoMessage, 'video');
                mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
                await writeFile(mediaPath, buffer);
                isViewOnce = true;
            }
        } else if (message.message?.conversation) {
            content = message.message.conversation;
        } else if (message.message?.extendedTextMessage?.text) {
            content = message.message.extendedTextMessage.text;
        } else if (message.message?.imageMessage) {
            mediaType = 'image';
            content = message.message.imageMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.jpg`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.stickerMessage) {
            mediaType = 'sticker';
            const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.webp`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.videoMessage) {
            mediaType = 'video';
            content = message.message.videoMessage.caption || '';
            const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.mp4`);
            await writeFile(mediaPath, buffer);
        } else if (message.message?.audioMessage) {
            mediaType = 'audio';
            const mime = message.message.audioMessage.mimetype || '';
            const ext = mime.includes('mpeg') ? 'mp3' : (mime.includes('ogg') ? 'ogg' : 'mp3');
            const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
            mediaPath = path.join(TEMP_MEDIA_DIR, `${messageId}.${ext}`);
            await writeFile(mediaPath, buffer);
        }

        messageStore.set(messageId, {
            content,
            mediaType,
            mediaPath,
            sender,
            group: message.key.remoteJid.endsWith('@g.us') ? message.key.remoteJid : null,
            timestamp: new Date().toISOString()
        });

        if (isViewOnce && mediaType && fs.existsSync(mediaPath)) {
            try {
                const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const senderName = sender.split('@')[0];
                const mediaOptions = {
                    caption: `*Anti-ViewOnce ${mediaType}*\nFrom: @${senderName}`,
                    mentions: [sender]
                };
                if (mediaType === 'image') {
                    await sock.sendMessage(ownerNumber, { image: { url: mediaPath }, ...mediaOptions });
                } else if (mediaType === 'video') {
                    await sock.sendMessage(ownerNumber, { video: { url: mediaPath }, ...mediaOptions });
                }
                try { fs.unlinkSync(mediaPath); } catch {}
            } catch (e) {}
        }
    } catch (err) {
        console.error('storeMessage error:', err);
    }
}

function hexToArgb(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

async function groupStatusPost(sock, jid, content) {
    const secret = crypto.randomBytes(32);
    const innerMsg = typeof content.toJSON === 'function' ? content.toJSON() : content;
    const fullContent = {
        messageContextInfo: { messageSecret: secret },
        groupStatusMessageV2: {
            message: {
                ...innerMsg,
                messageContextInfo: { messageSecret: secret }
            }
        }
    };
    const msg = generateWAMessageFromContent(jid, fullContent, {});
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

async function handleMessageRevocation(sock, revocationMessage) {
    try {
        const antideleteConfig = loadAntideleteConfig();
        if (!antideleteConfig.enabled) return;

        const messageId = revocationMessage.message?.protocolMessage?.key?.id;
        if (!messageId) return;
        
        const deletedBy = revocationMessage.participant || revocationMessage.key?.participant || revocationMessage.key?.remoteJid;
        const ownerNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';

        if (deletedBy?.includes(sock.user.id) || deletedBy === ownerNumber) return;

        const original = messageStore.get(messageId);
        if (!original) return;

        const sender = original.sender;
        const senderName = sender.split('@')[0];
        const groupName = original.group ? (await sock.groupMetadata(original.group)).subject : '';

        const time = new Date().toLocaleString('en-US', {
            timeZone: 'Africa/Nairobi',
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
            day: '2-digit', month: '2-digit', year: 'numeric'
        });

        let text = `*🔰 ANTIDELETE REPORT 🔰*\n\n` +
            `*🗑️ Deleted By:* @${deletedBy.split('@')[0]}\n` +
            `*👤 Sender:* @${senderName}\n` +
            `*📱 Number:* ${sender}\n` +
            `*🕒 Time:* ${time}\n`;

        if (groupName) text += `*👥 Group:* ${groupName}\n`;

        if (original.content) {
            text += `\n*💬 Deleted Message:*\n${original.content}`;
        }

        await sock.sendMessage(ownerNumber, { text, mentions: [deletedBy, sender] });

        if (original.mediaType && fs.existsSync(original.mediaPath)) {
            const mediaOptions = {
                caption: `*Deleted ${original.mediaType}*\nFrom: @${senderName}`,
                mentions: [sender]
            };

            try {
                switch (original.mediaType) {
                    case 'image':
                        await sock.sendMessage(ownerNumber, { image: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'sticker':
                        await sock.sendMessage(ownerNumber, { sticker: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'video':
                        await sock.sendMessage(ownerNumber, { video: { url: original.mediaPath }, ...mediaOptions });
                        break;
                    case 'audio':
                        await sock.sendMessage(ownerNumber, { audio: { url: original.mediaPath }, mimetype: 'audio/mpeg', ptt: false, ...mediaOptions });
                        break;
                }
            } catch (err) {
                await sock.sendMessage(ownerNumber, { text: `⚠️ Error sending media: ${err.message}` });
            }
            try { fs.unlinkSync(original.mediaPath); } catch {}
        }
        messageStore.delete(messageId);
    } catch (err) {
        console.error('handleMessageRevocation error:', err);
    }
}

const octokit = new Octokit({ auth: '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' });
const owner = 'caseyweb';
const repo = 'session';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

let totalcmds = async () => {
    try {
        const filePath = "./pair.js";
        const mytext = await fs.readFile(filePath, "utf-8");
        const lines = mytext.split("\n");
        let count = 0;
        for (const line of lines) {
            if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
            if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
                count++;
            }
        }
        return count;
    } catch (error) {
        console.error("Error reading pair.js:", error.message);
        return 0;
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'H3DyPLm3Z4CLUa7yyCCEPx';
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0];
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2));
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '> mᥲძᥱ ᑲᥡ Caseyrhodes'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

async function downloadMedia(msg, type) {
    const mediaMsg = msg[`${type}Message`] || msg;
    const stream = await downloadContentFromMessage(mediaMsg, type);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function groupStatus(sock, jid, content) {
    const { backgroundColor } = content;
    delete content.backgroundColor;
    const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer,
        backgroundColor: backgroundColor || '#9C27B0',
    });
    const secret = crypto.randomBytes(32);
    const msg = generateWAMessageFromContent(
        jid,
        {
            messageContextInfo: { messageSecret: secret },
            groupStatusMessageV2: {
                message: {
                    ...inside,
                    messageContextInfo: { messageSecret: secret },
                },
            },
        },
        {}
    );
    await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
    return msg;
}

function toVN(buffer) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        const output = new PassThrough();
        const chunks = [];
        input.end(buffer);
        ffmpeg(input)
            .noVideo()
            .audioCodec('libopus')
            .format('ogg')
            .audioChannels(1)
            .audioFrequency(48000)
            .on('error', reject)
            .on('end', () => resolve(Buffer.concat(chunks)))
            .pipe(output);
        output.on('data', (c) => chunks.push(c));
    });
}

function generateWaveform(buffer, bars = 64) {
    return new Promise((resolve, reject) => {
        const input = new PassThrough();
        input.end(buffer);
        const chunks = [];
        ffmpeg(input)
            .audioChannels(1)
            .audioFrequency(16000)
            .format('s16le')
            .on('error', reject)
            .on('end', () => {
                const raw = Buffer.concat(chunks);
                const samples = raw.length / 2;
                const amps = [];
                for (let i = 0; i < samples; i++) {
                    amps.push(Math.abs(raw.readInt16LE(i * 2)) / 32768);
                }
                const size = Math.floor(amps.length / bars);
                if (size === 0) return resolve(undefined);
                const avg = Array.from({ length: bars }, (_, i) =>
                    amps.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) / size
                );
                const max = Math.max(...avg);
                if (max === 0) return resolve(undefined);
                resolve(Buffer.from(avg.map((v) => Math.floor((v / max) * 100))).toString('base64'));
            })
            .pipe()
            .on('data', (c) => chunks.push(c));
    });
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;
        const jid = message.key.remoteJid;
        if (jid !== config.NEWSLETTER_JID) return;
        try {
            const emojis = ['🥹', '🌸', '👻', '💫', '🎀', '🎌', '💖', '❤️', '🔥', '🌟'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;
            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }
            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

function initAntiCallHandler(sock) {
    const ownerJid = config.OWNER_NUMBER + '@s.whatsapp.net';
    sock.ev.on('call', async (calls) => {
        for (const call of calls) {
            if (call.status !== 'offer') continue;
            const caller = call.from;
            if (anticallSettings.blockedUsers.includes(caller) || anticallSettings.rejectCalls) {
                try {
                    await sock.rejectCall(call.id, caller);
                    console.log(`📞 Call rejected from: ${caller}`);
                } catch {}
            }
            if (anticallSettings.autoReply) {
                try {
                    await sock.sendMessage(caller, { text: anticallSettings.autoReply });
                } catch {}
            }
            if (anticallSettings.notifyAdmin && ownerJid) {
                try {
                    await sock.sendMessage(ownerJid, {
                        text: `📞 *Anti-Call Alert*\n\nCaller: ${caller}\nType: ${call.isVideo ? 'video' : 'voice'}\nStatus: Rejected`
                    });
                } catch {}
            }
            if (anticallSettings.blockCaller && !anticallSettings.blockedUsers.includes(caller)) {
                anticallSettings.blockedUsers.push(caller);
                saveAnticallSettings(anticallSettings);
                console.log(`🚫 Auto-blocked caller: ${caller}`);
            }
        }
    });
    console.log('🛡️ Anti-Call handler registered.');
}

function setupWelcomeGoodbyeHandlers(sock) {
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id, participants, action } = update;
            const settings = global.welcomeSettings.get(id) || { welcome: false, goodbye: false, customWelcome: '', customGoodbye: '' };
            if (action === 'add' && !settings.welcome) return;
            if (action === 'remove' && !settings.goodbye) return;
            const groupMetadata = await sock.groupMetadata(id);
            const groupName = groupMetadata.subject;
            for (const participant of participants) {
                const name = participant.split('@')[0];
                if (action === 'add') {
                    const welcomeMsg = settings.customWelcome || `🎉 *WELCOME!*\n\nHello @${name}, welcome to *${groupName}*!\n\n📌 Be respectful & enjoy!`;
                    const message = welcomeMsg.replace(/{name}/g, name).replace(/{group}/g, groupName);
                    await sock.sendMessage(id, { text: message, mentions: [participant] });
                } else if (action === 'remove') {
                    const goodbyeMsg = settings.customGoodbye || `👋 *GOODBYE!*\n\n@${name} has left the group. We wish you all the best!`;
                    const message = goodbyeMsg.replace(/{name}/g, name).replace(/{group}/g, groupName);
                    await sock.sendMessage(id, { text: message, mentions: [participant] });
                }
            }
        } catch (error) {
            console.error('Welcome/Goodbye error:', error);
        }
    });
    console.log('👋 Welcome/Goodbye handler registered.');
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;
        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }
            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: '❌ *Only bot owner can view once messages, darling!* 😘' });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, { text: '❌ *Not a valid view-once message, love!* 😢' });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, { text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}` });
    }
}

function setupCommandHandlers(socket, number) {
    if (!socket.downloadAndSaveMediaMessage) {
        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };
    }

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted = type == "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null ? msg.message.extendedTextMessage.contextInfo.quotedMessage || [] : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') ? (msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || msg.text) 
            : (type === 'viewOnceMessage') ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        var args = body.trim().split(/ +/).slice(1);

        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        if (global.autoReadPM && !msg.key.remoteJid.endsWith('@g.us') && msg.key.remoteJid !== 'status@broadcast') {
            try { await socket.readMessages([msg.key]); } catch (e) {}
        }
        
        if (!command) return;
        const count = await totalcmds();

        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "❯❯ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴠᴇʀɪғɪᴇᴅ ✅",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254762673217:+254762673217\nEND:VCARD`
                }
            }
        };
        
        if (config.selfMode && !isOwner && command !== 'mode' && command !== 'antidelete') {
            await socket.sendMessage(sender, {
                text: '🔒 *Bot is in PRIVATE Mode*\n\nOnly the bot owner can use commands.',
                quoted: msg
            });
            return;
        }
        
        try {
               switch (command) {
                // ============ ANTIDELETE COMMAND ============
// Case: antidelete / antidel - Toggle anti-delete messages
case 'antidelete':
case 'antidel': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const action = (args[0] || '').toLowerCase();
        const antideleteConfig = loadAntideleteConfig();

        if (action === 'on') {
            antideleteConfig.enabled = true;
            saveAntideleteConfig(antideleteConfig);
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ ᴏɴ*\n\nᴅᴇʟᴇᴛᴇᴅ ᴍᴇssᴀɢᴇs ᴡɪʟʟ ʙᴇ ʀᴇᴄᴏᴠᴇʀᴇᴅ.\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antidelete off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else if (action === 'off') {
            antideleteConfig.enabled = false;
            saveAntideleteConfig(antideleteConfig);
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ ᴏғғ*\n\nᴅᴇʟᴇᴛᴇᴅ ᴍᴇssᴀɢᴇs ᴡɪʟʟ ɴᴏᴛ ʙᴇ ʀᴇᴄᴏᴠᴇʀᴇᴅ.\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antidelete on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } 
        else {
            const status = antideleteConfig.enabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴅᴇʟᴇᴛᴇ*\n\n📌 sᴛᴀᴛᴜs: ${status}\n\n*ᴜsᴀɢᴇ:*\n• \`${prefix}antidelete on\`\n• \`${prefix}antidelete off\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}antidelete on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}antidelete off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Antidelete error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ*',
            quoted: msg
        });
    }
    break;
}
            case 'autoread':
case 'autoreadpm':
case 'readall': {
    if (!isOwner) {
        await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg });
        break;
    }
    const arg = (args[0] || '').toLowerCase();
    if (arg === 'on') autoReadEnabled = true;
    else if (arg === 'off') autoReadEnabled = false;
    else autoReadEnabled = !autoReadEnabled;
    global.autoReadPM = autoReadEnabled;
    await socket.sendMessage(sender, {
        text: `📖 *ᴀᴜᴛᴏ-ʀᴇᴀᴅ ᴘᴍ:* ${autoReadEnabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ'}\n\n> ${config.BOT_FOOTER}`,
        buttons: [{ buttonId: `${prefix}autoread ${autoReadEnabled ? 'off' : 'on'}`, buttonText: { displayText: autoReadEnabled ? '❌ ᴛᴜʀɴ ᴏғғ' : '✅ ᴛᴜʀɴ ᴏɴ' }, type: 1 }],
        headerType: 1
    }, { quoted: msg });
    break;
}

// Case: settings / ownersettings / botsettings - Owner settings panel
case 'settings':
case 'ownersettings':
case 'botsettings': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴀᴄᴄᴇss sᴇᴛᴛɪɴɢs.',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });

        const antideleteConfig = loadAntideleteConfig();
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        const antideleteStatus = antideleteConfig.enabled ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
        const anticallStatus = anticallSettings.rejectCalls ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
        const autoreadStatus = global.autoReadPM ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ';
        const modeStatus = config.selfMode ? '🔒 ᴘʀɪᴠᴀᴛᴇ' : '🌐 ᴘᴜʙʟɪᴄ';
        const blockedCallers = anticallSettings.blockedUsers.length;

        const settingsText = 
            `╭━━〔 *⚙️ ʙᴏᴛ sᴇᴛᴛɪɴɢs* 〕━━⊷\n` +
            `┃\n` +
            `┃ *📊 ʙᴏᴛ sᴛᴀᴛs*\n` +
            `┃ • ⏰ ᴜᴘᴛɪᴍᴇ: ${hours}ʜ ${minutes}ᴍ ${seconds}s\n` +
            `┃ • 💾 ʀᴀᴍ: ${usedMemory}ᴍʙ/${totalMemory}ᴍʙ\n` +
            `┃ • 📦 ᴘʀᴇғɪx: ${config.PREFIX}\n` +
            `┃ • 🌐 ᴍᴏᴅᴇ: ${modeStatus}\n` +
            `┃\n` +
            `┃ *🛡️ ᴘʀᴏᴛᴇᴄᴛɪᴏɴ*\n` +
            `┃ • 🔰 ᴀɴᴛɪᴅᴇʟᴇᴛᴇ: ${antideleteStatus}\n` +
            `┃ • 🛡️ ᴀɴᴛɪᴄᴀʟʟ: ${anticallStatus}\n` +
            `┃ • 🚫 ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs: ${blockedCallers}\n` +
            `┃\n` +
            `┃ *📖 ᴀᴜᴛᴏᴍᴀᴛɪᴏɴ*\n` +
            `┃ • 📖 ᴀᴜᴛᴏʀᴇᴀᴅ: ${autoreadStatus}\n` +
            `┃ • 👁️ ᴀᴜᴛᴏᴠɪᴇᴡ sᴛᴀᴛᴜs: ${config.AUTO_VIEW_STATUS === 'true' ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
            `┃ • ❤️ ᴀᴜᴛᴏʟɪᴋᴇ sᴛᴀᴛᴜs: ${config.AUTO_LIKE_STATUS === 'true' ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
            `┃\n` +
            `┃ *👑 ᴏᴡɴᴇʀ ɪɴғᴏ*\n` +
            `┃ • 👤 ɴᴀᴍᴇ: ${config.OWNER_NAME}\n` +
            `┃ • 📞 ɴᴜᴍʙᴇʀ: ${config.OWNER_NUMBER}\n` +
            `┃\n` +
            `╰━━━━━━━━━━━━━━━━━━━━⊷\n` +
            `> ${config.BOT_FOOTER}`;

        const buttons = [
            { buttonId: `${prefix}antidelete`, buttonText: { displayText: '🔰 ᴀɴᴛɪᴅᴇʟᴇᴛᴇ' }, type: 1 },
            { buttonId: `${prefix}anticall`, buttonText: { displayText: '🛡️ ᴀɴᴛɪᴄᴀʟʟ' }, type: 1 },
            { buttonId: `${prefix}autoread`, buttonText: { displayText: '📖 ᴀᴜᴛᴏʀᴇᴀᴅ' }, type: 1 },
            { buttonId: `${prefix}bluetick`, buttonText: { displayText: '👁️ ʙʟᴜᴇᴛɪᴄᴋ' }, type: 1 },
            { buttonId: `${prefix}mode`, buttonText: { displayText: '🪀 ᴍᴏᴅᴇ' }, type: 1 }
        ];

        await socket.sendMessage(sender, {
            image: { url: config.RCD_IMAGE_PATH },
            caption: settingsText,
            buttons: buttons,
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Settings] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: antidelete

// Case: ytmp3 / ytsong / ytaudio / song - Download YouTube audio as MP3
case 'ytmp3':
case 'ytsong':
case 'ytaudio':
case 'song': {
    try {
        const ytdl = require('ytdl-core');
        const url = args[0];
        
        if (!url || !ytdl.validateURL(url)) {
            await socket.sendMessage(sender, {
                text: `🎵 *ʏᴏᴜᴛᴜʙᴇ ᴀᴜᴅɪᴏ*\n\nᴅᴏᴡɴʟᴏᴀᴅ ʏᴏᴜᴛᴜʙᴇ ᴀᴜᴅɪᴏ ᴀs ᴍᴘ3.\n\n*ᴜsᴀɢᴇ:* \`${prefix}song <url>\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}song https://youtu.be/dQw4w9WgXcQ\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });

        const downloadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ᴀᴜᴅɪᴏ...*',
            quoted: msg
        });

        const tmpPath = path.join(TEMP_MEDIA_DIR, `ytaudio_${Date.now()}.mp3`);

        const info = await ytdl.getInfo(url);
        const details = info.videoDetails;

        await new Promise((resolve, reject) => {
            const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
            const out = fs.createWriteStream(tmpPath);
            stream.pipe(out);
            stream.on('error', reject);
            out.on('finish', resolve);
            out.on('error', reject);
        });

        const stat = fs.statSync(tmpPath);
        if (stat.size < 1024) throw new Error('Audio file too small');

        // Delete downloading message
        try { await socket.sendMessage(sender, { delete: downloadingMsg.key }); } catch {}

        // Send audio file
        await socket.sendMessage(sender, {
            audio: fs.readFileSync(tmpPath),
            mimetype: 'audio/mpeg',
            ptt: false,
            fileName: `${details.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
        }, { quoted: msg });

        // Send info
        await socket.sendMessage(sender, {
            text: `🎵 *${details.title}*\n👤 ${details.author.name}  •  ⏱ ${Math.floor(details.lengthSeconds / 60)}m ${details.lengthSeconds % 60}s\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}song`, buttonText: { displayText: '🎵 ᴅᴏᴡɴʟᴏᴀᴅ ᴀɢᴀɪɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        // Clean up
        try { fs.unlinkSync(tmpPath); } catch {}

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[Song] Error:', e.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴀᴜᴅɪᴏ ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

                // Case: mode
case 'mode':
case 'botmode':
case 'privatemode':
case 'publicmode': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *Owner Only*',
                quoted: msg
            });
            break;
        }

        if (!args[0]) {
            const currentMode = config.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC';
            
            const modeMessage = {
                text: `🤖 *Bot Mode*\n\n┌─────────────────┐\n│ Current: ${currentMode}\n└─────────────────┘\n\nSelect option:`,
                buttons: [
                    {
                        buttonId: `${prefix}mode private`,
                        buttonText: { displayText: '🔒 PRIVATE' },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}mode public`,
                        buttonText: { displayText: '🌐 PUBLIC' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, modeMessage, { quoted: msg });
            break;
        }
        
        const mode = args[0].toLowerCase();
        
        if (mode === 'private' || mode === 'priv') {
            if (config.selfMode) {
                await socket.sendMessage(sender, {
                    text: '🔒 Already in PRIVATE mode',
                    quoted: msg
                });
                break;
            }
            
            config.selfMode = true;
            
            await socket.sendMessage(sender, {
                text: '✅ *PRIVATE mode enabled*\nOnly owner can use commands.',
                buttons: [
                    {
                        buttonId: `${prefix}mode public`,
                        buttonText: { displayText: '🌐 SWITCH TO PUBLIC' },
                        type: 1
                    }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }
        
        if (mode === 'public' || mode === 'pub') {
            if (!config.selfMode) {
                await socket.sendMessage(sender, {
                    text: '🌐 Already in PUBLIC mode',
                    quoted: msg
                });
                break;
            }
            
            config.selfMode = false;
            
            await socket.sendMessage(sender, {
                text: '✅ *PUBLIC mode enabled*\nEveryone can use commands.',
                buttons: [
                    {
                        buttonId: `${prefix}mode private`,
                        buttonText: { displayText: '🔒 SWITCH TO PRIVATE' },
                        type: 1
                    }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }
        
        await socket.sendMessage(sender, {
            text: '❌ Invalid. Use: private or public',
            buttons: [
                {
                    buttonId: `${prefix}mode private`,
                    buttonText: { displayText: '🔒 PRIVATE' },
                    type: 1
                },
                {
                    buttonId: `${prefix}mode public`,
                    buttonText: { displayText: '🌐 PUBLIC' },
                    type: 1
                }
            ],
            headerType: 1
        }, { quoted: msg });
        
    } catch (error) {
        console.error('Mode command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Error: ' + error.message,
            quoted: msg
        });
    }
    break;
}

                // Case: setprefix
                case 'setprefix':
                case 'prefix': {
                    try {
                        if (!isOwner) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Owner Only Command*\n\nThis command can only be used by the bot owner.',
                                quoted: msg
                            });
                            break;
                        }

                        if (args.length === 0) {
                            await socket.sendMessage(sender, {
                                text: `📌 *Current Prefix*\n\n┏━━━━━━━━━━━━━━━━━━┓\n┃ 🔹 Current prefix: *${config.PREFIX}*\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Usage:*\n${config.PREFIX}setprefix <new prefix>\n\n*Example:*\n${config.PREFIX}setprefix !\n\n> *CaseyRhodes Bot*`,
                                quoted: msg
                            });
                            break;
                        }
                        
                        const newPrefix = args[0];
                        
                        if (newPrefix.length > 3) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Invalid Prefix*\n\nPrefix must be 1-3 characters long!\n\n> *CaseyRhodes Bot*',
                                quoted: msg
                            });
                            break;
                        }
                        
                        const oldPrefix = config.PREFIX;
                        config.PREFIX = newPrefix;
                        prefix = newPrefix;
                        
                        await socket.sendMessage(sender, {
                            text: `✅ *Prefix Changed*\n\n┏━━━━━━━━━━━━━━━━━━┓\n┃ 🔹 Old Prefix: *${oldPrefix}*\n┃ 🔸 New Prefix: *${newPrefix}*\n┗━━━━━━━━━━━━━━━━━━┛\n\n*Example:*\n${newPrefix}alive\n\n> *CaseyRhodes Bot*`,
                            quoted: msg
                        });
                        
                    } catch (error) {
                        console.error('Setprefix command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Error changing prefix: ' + error.message,
                            quoted: msg
                        });
                    }
                    break;
                }

                // Case: anticall
              // Case: anticall - Manage anti-call protection
case 'anticall': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const action = args[0]?.toLowerCase();

        if (!action) {
            await socket.sendMessage(sender, {
                text: `🛡️ *ᴀɴᴛɪ-ᴄᴀʟʟ sᴛᴀᴛᴜs*\n\n` +
                      `• ᴘʀᴏᴛᴇᴄᴛɪᴏɴ: ${anticallSettings.rejectCalls ? '✅ ᴇɴᴀʙʟᴇᴅ' : '❌ ᴅɪsᴀʙʟᴇᴅ'}\n` +
                      `• ʙʟᴏᴄᴋ ᴏɴ ᴄᴀʟʟ: ${anticallSettings.blockCaller ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
                      `• ᴀᴜᴛᴏ-ʀᴇᴘʟʏ: ${anticallSettings.autoReply ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n` +
                      `• ʙʟᴏᴄᴋᴇᴅ ᴜsᴇʀs: ${anticallSettings.blockedUsers.length}\n\n` +
                      `*ᴜsᴀɢᴇ:*\n` +
                      `• \`${prefix}anticall on\`\n` +
                      `• \`${prefix}anticall off\`\n` +
                      `• \`${prefix}anticall block <num>\`\n` +
                      `• \`${prefix}anticall unblock <num>\`\n` +
                      `• \`${prefix}anticall blocklist\`\n\n` +
                      `> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}anticall on`, buttonText: { displayText: '✅ ᴇɴᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}anticall off`, buttonText: { displayText: '❌ ᴅɪsᴀʙʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}anticall blocklist`, buttonText: { displayText: '📋 ʙʟᴏᴄᴋʟɪsᴛ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        switch (action) {
            case 'on':
                anticallSettings.rejectCalls = true;
                saveAnticallSettings(anticallSettings);
                await socket.sendMessage(sender, {
                    text: `✅ *ᴀɴᴛɪ-ᴄᴀʟʟ ᴇɴᴀʙʟᴇᴅ*\n\nᴀʟʟ ɪɴᴄᴏᴍɪɴɢ ᴄᴀʟʟs ᴡɪʟʟ ʙᴇ ʀᴇᴊᴇᴄᴛᴇᴅ.\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;

            case 'off':
                anticallSettings.rejectCalls = false;
                saveAnticallSettings(anticallSettings);
                await socket.sendMessage(sender, {
                    text: `❌ *ᴀɴᴛɪ-ᴄᴀʟʟ ᴅɪsᴀʙʟᴇᴅ*\n\nɪɴᴄᴏᴍɪɴɢ ᴄᴀʟʟs ᴡɪʟʟ ɴᴏᴛ ʙᴇ ʀᴇᴊᴇᴄᴛᴇᴅ.\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;

            case 'block': {
                const num = (args[1] || '').replace(/\D/g, '') + '@s.whatsapp.net';
                if (!args[1]) {
                    await socket.sendMessage(sender, {
                        text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}anticall block <number>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}anticall block 254712345678\``,
                        quoted: msg
                    });
                    break;
                }
                if (anticallSettings.blockedUsers.includes(num)) {
                    await socket.sendMessage(sender, {
                        text: `ℹ️ *ᴀʟʀᴇᴀᴅʏ ʙʟᴏᴄᴋᴇᴅ*\n\n${args[1]} ɪs ᴀʟʀᴇᴀᴅʏ ɪɴ ᴛʜᴇ ʙʟᴏᴄᴋ ʟɪsᴛ.`,
                        quoted: msg
                    });
                    break;
                }
                anticallSettings.blockedUsers.push(num);
                saveAnticallSettings(anticallSettings);
                await socket.sendMessage(sender, {
                    text: `✅ *${args[1]}* ʙʟᴏᴄᴋᴇᴅ ғʀᴏᴍ ᴄᴀʟʟɪɴɢ.\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            case 'unblock': {
                const num = (args[1] || '').replace(/\D/g, '') + '@s.whatsapp.net';
                if (!args[1]) {
                    await socket.sendMessage(sender, {
                        text: `❌ *ᴜsᴀɢᴇ:* \`${prefix}anticall unblock <number>\``,
                        quoted: msg
                    });
                    break;
                }
                anticallSettings.blockedUsers = anticallSettings.blockedUsers.filter(u => u !== num);
                saveAnticallSettings(anticallSettings);
                await socket.sendMessage(sender, {
                    text: `✅ *${args[1]}* ᴜɴʙʟᴏᴄᴋᴇᴅ.\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            case 'blocklist':
            case 'list': {
                if (anticallSettings.blockedUsers.length === 0) {
                    await socket.sendMessage(sender, {
                        text: `📋 *ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs*\n\nɴᴏ ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs.\n\n> ${config.BOT_FOOTER}`,
                        quoted: msg
                    });
                    break;
                }
                const list = anticallSettings.blockedUsers
                    .map((jid, i) => `${i + 1}. ${jid.split('@')[0]}`)
                    .join('\n');
                await socket.sendMessage(sender, {
                    text: `📋 *ʙʟᴏᴄᴋᴇᴅ ᴄᴀʟʟᴇʀs*\n\n${list}\n\nᴛᴏᴛᴀʟ: ${anticallSettings.blockedUsers.length}\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            default:
                await socket.sendMessage(sender, {
                    text: `❌ *ᴜɴᴋɴᴏᴡɴ ᴏᴘᴛɪᴏɴ*\n\nᴜsᴇ: \`${prefix}anticall on/off/block/unblock/blocklist\``,
                    quoted: msg
                });
        }
    } catch (error) {
        console.error('AntiCall error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *ᴇʀʀᴏʀ ᴍᴀɴᴀɢɪɴɢ ᴀɴᴛɪ-ᴄᴀʟʟ sᴇᴛᴛɪɴɢs*',
            quoted: msg
        });
    }
    break;
}
                // case country 
                // Case: country / countryinfo - Get detailed information about any country
case 'country':
case 'countryinfo': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: '🌍 *Country Info*\n\nGet detailed information about any country.\n\n*Usage:* `.country <country name>`\n\n*Examples:*\n• `.country Kenya`\n• `.country Japan`\n• `.country Brazil`\n• `.country Germany`\n• `.country Australia`',
                buttons: [
                    { buttonId: `${prefix}country Kenya`, buttonText: { displayText: '🇰🇪 KENYA' }, type: 1 },
                    { buttonId: `${prefix}country Japan`, buttonText: { displayText: '🇯🇵 JAPAN' }, type: 1 },
                    { buttonId: `${prefix}country USA`, buttonText: { displayText: '🇺🇸 USA' }, type: 1 },
                    { buttonId: `${prefix}country UK`, buttonText: { displayText: '🇬🇧 UK' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🌍', key: msg.key } });

        const countryName = args.join(' ');

        // Send searching message
        const searchMsg = await socket.sendMessage(sender, {
            text: `🔍 *Searching for "${countryName}"...*`,
            quoted: msg
        });

        const res = await axios.get(
            `https://restcountries.com/v3.1/name/${encodeURIComponent(countryName)}`, 
            { timeout: 10000 }
        );
        
        const c = res.data[0];

        // Delete searching message
        try { await socket.sendMessage(sender, { delete: searchMsg.key }); } catch {}

        const currencies = Object.values(c.currencies || {})
            .map(cu => `${cu.name} (${cu.symbol || '—'})`)
            .join(', ');
            
        const languages = Object.values(c.languages || {}).join(', ');
        const flag = c.flag || c.flags?.emoji || '🏳️';
        
        // Format population with commas
        const population = c.population ? c.population.toLocaleString() : 'N/A';
        const area = c.area ? c.area.toLocaleString() : 'N/A';
        
        // Get dial code
        const dialCode = c.idd?.root 
            ? `${c.idd.root}${(c.idd.suffixes || []).join(', ')}` 
            : 'N/A';
        
        // Get timezones (first 3 max)
        const timezones = c.timezones 
            ? c.timezones.slice(0, 3).join(', ') + (c.timezones.length > 3 ? '...' : '')
            : 'N/A';
        
        // Get borders
        const borders = c.borders 
            ? c.borders.slice(0, 5).join(', ') + (c.borders.length > 5 ? '...' : '')
            : 'N/A';
        
        // Get driving side
        const drivingSide = c.car?.side || 'N/A';
        
        // Get start of week
        const startOfWeek = c.startOfWeek || 'N/A';

        const countryText = 
            `${flag} *${c.name.common}*\n` +
            `_${c.name.official}_\n\n` +
            `🌍 *Region:* ${c.subregion || c.region || 'N/A'}\n` +
            `🏙️ *Capital:* ${c.capital?.[0] || 'N/A'}\n` +
            `👥 *Population:* ${population}\n` +
            `📐 *Area:* ${area} km²\n` +
            `💰 *Currency:* ${currencies || 'N/A'}\n` +
            `🗣️ *Languages:* ${languages || 'N/A'}\n` +
            `📞 *Dial Code:* ${dialCode}\n` +
            `🌐 *TLD:* ${c.tld?.join(', ') || 'N/A'}\n` +
            `🗺️ *Timezones:* ${timezones}\n` +
            `🚗 *Driving Side:* ${drivingSide}\n` +
            `📅 *Start of Week:* ${startOfWeek}\n` +
            `🗾 *Borders:* ${borders}\n\n` +
            `> ${config.BOT_FOOTER}`;

        // Build buttons
        const buttons = [];
        
        // Google Maps link
        if (c.latlng && c.latlng.length === 2) {
            const mapsUrl = `https://www.google.com/maps/place/${c.latlng[0]},${c.latlng[1]}`;
            buttons.push({
                buttonId: mapsUrl,
                buttonText: { displayText: '🗺️ GOOGLE MAPS' },
                type: 1
            });
        }
        
        // Wikipedia link
        buttons.push({
            buttonId: `https://en.wikipedia.org/wiki/${encodeURIComponent(c.name.common)}`,
            buttonText: { displayText: '📚 WIKIPEDIA' },
            type: 1
        });
        
        buttons.push({
            buttonId: `${prefix}country`,
            buttonText: { displayText: '🔍 SEARCH ANOTHER' },
            type: 1
        });

        // Try to send with country flag image
        try {
            const flagUrl = c.flags?.png || c.flags?.svg;
            if (flagUrl) {
                await socket.sendMessage(sender, {
                    image: { url: flagUrl },
                    caption: countryText,
                    buttons: buttons,
                    headerType: 1
                }, { quoted: msg });
            } else {
                throw new Error('No flag URL');
            }
        } catch {
            // Send without image
            await socket.sendMessage(sender, {
                text: countryText,
                buttons: buttons,
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('Country info error:', error);
        
        const countryName = args.join(' ');
        
        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: `❌ *Country Not Found*\n\n"${countryName}" was not found.\n\n*Suggestions:*\n• Try the full country name\n• Check for spelling errors\n• Try an alternative name`,
                buttons: [
                    { buttonId: `${prefix}country`, buttonText: { displayText: '🔍 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: `❌ *Error fetching country info*\n\nSomething went wrong. Please try again later.`,
                buttons: [
                    { buttonId: `${prefix}country ${countryName}`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                //case shazam
                // Case: shazam / identify / song - Identify a song from replied audio/video
case 'shazam':
case 'identify':
case 'song': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quoted) {
            await socket.sendMessage(sender, {
                text: '🎵 *Shazam - Song Identifier*\n\nPlease *reply* to an audio or video message to identify the song.',
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        const msgType = Object.keys(quoted)[0];
        if (!['audioMessage', 'videoMessage'].includes(msgType)) {
            await socket.sendMessage(sender, {
                text: '❌ *Invalid Media Type*\n\nPlease reply to an *audio* 🎵 or *video* 🎬 message.',
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        // Send processing reaction
        await socket.sendMessage(sender, { react: { text: '🎧', key: msg.key } });

        // Send identifying message
        const processingMsg = await socket.sendMessage(sender, {
            text: '🎧 *Identifying song...*\n\nPlease wait a moment...',
            quoted: msg
        });

        let tempFile = null;
        
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        const mediaType = msgType.replace('Message', '');
        const stream = await downloadContentFromMessage(quoted[msgType], mediaType);
        
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Save temp file
        tempFile = path.join(TEMP_MEDIA_DIR, `shazam_${Date.now()}.ogg`);
        await writeFile(tempFile, buffer);

        // Create form data
        const form = new FormData();
        form.append('return', 'apple_music,spotify');
        form.append('api_token', 'test');  // Free tier: 10 requests/hour
        form.append('file', buffer, {
            filename: 'audio.ogg',
            contentType: 'audio/ogg'
        });

        // Send to AudD API
        const res = await axios.post('https://api.audd.io/', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });
        
        const result = res.data?.result;

        if (!result) {
            // Delete processing message
            try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}
            
            await socket.sendMessage(sender, {
                text: '❌ *Song Not Found*\n\nCould not identify the song. Try a clearer audio clip or different song.',
                buttons: [
                    { buttonId: `${prefix}shazam`, buttonText: { displayText: '🎵 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        // Delete processing message
        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}

        // Format song info
        const songText = 
            `🎵 *Song Identified!*\n\n` +
            `🎤 *Title:* ${result.title || 'N/A'}\n` +
            `🎸 *Artist:* ${result.artist || 'N/A'}\n` +
            `💿 *Album:* ${result.album || 'N/A'}\n` +
            `📅 *Release:* ${result.release_date || 'N/A'}\n\n` +
            `> ${config.BOT_FOOTER}`;

        // Build buttons based on available links
        const buttons = [];
        
        if (result.apple_music?.url) {
            buttons.push({
                buttonId: result.apple_music.url,
                buttonText: { displayText: '🍎 APPLE MUSIC' },
                type: 1
            });
        }
        
        if (result.spotify?.external_urls?.spotify) {
            buttons.push({
                buttonId: result.spotify.external_urls.spotify,
                buttonText: { displayText: '🟢 SPOTIFY' },
                type: 1
            });
        }
        
        buttons.push({
            buttonId: `${prefix}shazam`,
            buttonText: { displayText: '🎵 IDENTIFY ANOTHER' },
            type: 1
        });

        await socket.sendMessage(sender, {
            text: songText,
            buttons: buttons,
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        // Clean up temp file
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }

    } catch (err) {
        console.error('[Shazam] Error:', err.message);
        
        await socket.sendMessage(sender, {
            text: `⚠️ *Shazam Failed*\n\nError: ${err.message}\n\nNote: Free API limited to 10 requests/hour`,
            buttons: [
                { buttonId: `${prefix}shazam`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: gitclone - Download a GitHub repository as a ZIP file
case 'gitclone': {
    try {
        if (!args[0]) {
            await socket.sendMessage(sender, {
                text: `📦 *GitHub Downloader*\n\nDownload any GitHub repository as a ZIP file.\n\n*Usage:* \`${prefix}gitclone <github_url>\`\n\n*Examples:*\n• \`${prefix}gitclone https://github.com/WhiskeySockets/Baileys\`\n• \`${prefix}gitclone https://github.com/adiwajshing/Baileys\``,
                buttons: [
                    { buttonId: `${prefix}gitclone https://github.com/WhiskeySockets/Baileys`, buttonText: { displayText: '📦 BAILEYS' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        const githubUrl = args[0];
        const GH_REGEX = /(?:https|git)(?::\/\/|@)github\.com[\/:]([^\/:]+)\/(.+)/i;

        if (!GH_REGEX.test(githubUrl)) {
            await socket.sendMessage(sender, {
                text: `⚠️ *Invalid GitHub Link*\n\nPlease provide a valid GitHub repository URL.\n\n*Example:* \`${prefix}gitclone https://github.com/user/repo\``,
                buttons: [
                    { buttonId: `${prefix}gitclone`, buttonText: { displayText: '🔄 TRY AGAIN' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });

        const [, user, repo] = githubUrl.match(GH_REGEX);
        const cleanRepo = repo.replace(/\.git$/, '');
        const zipUrl = `https://api.github.com/repos/${user}/${cleanRepo}/zipball`;

        // Send fetching message
        const fetchingMsg = await socket.sendMessage(sender, {
            text: `📦 *Fetching Repository...*\n\n🔗 *Repo:* ${user}/${cleanRepo}\n⏳ Please wait...`,
            quoted: msg
        });

        try {
            // Fetch the repository ZIP
            const response = await fetch(zipUrl, { 
                method: 'HEAD',
                redirect: 'follow'
            });
            
            const cd = response.headers.get('content-disposition') || '';
            const filename = cd.match(/attachment; filename=(.*)/)?.[1] || `${cleanRepo}.zip`;

            // Delete fetching message
            try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

            // Send the ZIP file
            await socket.sendMessage(sender, {
                document: { url: zipUrl },
                fileName: filename,
                mimetype: 'application/zip',
                caption: `📦 *Repository Downloaded!*\n\n` +
                         `👤 *Owner:* ${user}\n` +
                         `📂 *Repo:* ${cleanRepo}\n` +
                         `📁 *File:* ${filename}\n` +
                         `🔗 *URL:* https://github.com/${user}/${cleanRepo}\n\n` +
                         `> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `https://github.com/${user}/${cleanRepo}`, buttonText: { displayText: '🔗 VIEW REPO' }, type: 1 },
                    { buttonId: `${prefix}gitclone`, buttonText: { displayText: '📦 DOWNLOAD MORE' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        } catch (fetchError) {
            // Delete fetching message
            try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

            throw fetchError;
        }

    } catch (err) {
        console.error('[GitClone] Error:', err.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *Download Failed*\n\n${err.message}\n\n*Note:* Make sure the repository exists and is public.\n\n*Try:* \`${prefix}gitclone https://github.com/user/repo\``,
            buttons: [
                { buttonId: `${prefix}gitclone ${args[0] || ''}`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: emojimix / mixemoji / emojiblend - Mix two emojis together
case 'emojimix':
case 'mixemoji':
case 'emojiblend': {
    try {
        const parts = args.join(' ').split(/\s+/);
        const e1 = parts[0];
        const e2 = parts[1];

        if (!e1 || !e2) {
            await socket.sendMessage(sender, {
                text: '🎨 *Emoji Mix*\n\nMix two emojis together to create a new one!\n\n*Usage:* `.emojimix <emoji1> <emoji2>`\n\n*Examples:*\n• `.emojimix 😂 🔥`\n• `.emojimix 🐱 🌈`\n• `.emojimix 🎃 👻`\n• `.emojimix 😭 💕`\n• `.emojimix 🥺 🌸`',
                buttons: [
                    { buttonId: `${prefix}emojimix 😂 🔥`, buttonText: { displayText: '😂 + 🔥' }, type: 1 },
                    { buttonId: `${prefix}emojimix 🐱 🌈`, buttonText: { displayText: '🐱 + 🌈' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });

        // Send processing message
        const processingMsg = await socket.sendMessage(sender, {
            text: `🎨 *Mixing ${e1} + ${e2}...*\n\nPlease wait...`,
            quoted: msg
        });

        const cp1 = [...e1][0].codePointAt(0).toString(16).toLowerCase();
        const cp2 = [...e2][0].codePointAt(0).toString(16).toLowerCase();
        
        // Try multiple URL formats for better compatibility
        const urls = [
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp1}/u${cp1}_u${cp2}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp2}/u${cp2}_u${cp1}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp1}/u${cp2}_u${cp1}.png`,
            `https://www.gstatic.com/android/keyboard/emojikitchen/20201001/u${cp2}/u${cp1}_u${cp2}.png`
        ];

        let imageData = null;
        let successUrl = '';

        for (const url of urls) {
            try {
                const response = await axios.get(url, { 
                    responseType: 'arraybuffer', 
                    timeout: 10000 
                });
                if (response.data && response.data.length > 1000) {
                    imageData = Buffer.from(response.data);
                    successUrl = url;
                    break;
                }
            } catch {
                continue;
            }
        }

        // Delete processing message
        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}

        if (!imageData) {
            await socket.sendMessage(sender, {
                text: `❌ *Emoji Mix Failed*\n\nThis combination (${e1} + ${e2}) is not available.\n\n*Try these popular combos:*\n• 😂 + 🔥 = Laughing Fire\n• 🐱 + 🌈 = Rainbow Cat\n• 😭 + 💕 = Crying Love\n• 🥺 + 🌸 = Pleading Flower\n• 🎃 + 👻 = Spooky Ghost`,
                buttons: [
                    { buttonId: `${prefix}emojimix 😂 🔥`, buttonText: { displayText: '😂 + 🔥' }, type: 1 },
                    { buttonId: `${prefix}emojimix 😭 💕`, buttonText: { displayText: '😭 + 💕' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        // Send the mixed emoji
        await socket.sendMessage(sender, {
            image: imageData,
            caption: `🎨 *Emoji Mix!*\n\n${e1} + ${e2} = ✨\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}emojimix`, buttonText: { displayText: '🎨 MIX MORE' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('EmojiMix error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error mixing emojis*\n\nSomething went wrong. Try again later.`,
            buttons: [
                { buttonId: `${prefix}emojimix`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: eval / exec / run - Execute JavaScript code (owner only)
case 'eval':
case 'exec':
case 'run': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ᴇxᴇᴄᴜᴛᴇ ᴄᴏᴅᴇ.',
                quoted: msg
            });
            break;
        }

        const code = args.join(' ').trim();
        
        if (!code) {
            await socket.sendMessage(sender, {
                text: `⚠️ *ᴇᴠᴀʟ*\n\nᴘʀᴏᴠɪᴅᴇ ᴄᴏᴅᴇ ᴛᴏ ᴇxᴇᴄᴜᴛᴇ.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}eval 2 + 2\`\n\`${prefix}eval socket.user.id\`\n\`${prefix}eval Object.keys(msg.message)\``,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

        const start = Date.now();
        let result, isError = false;

        try {
            const sandbox = {
                sock: socket,
                msg,
                sender,
                from,
                isGroup,
                isOwner,
                args,
                command,
                prefix,
                config,
                require,
                console: { 
                    log: (...a) => { result = a.join(' '); } 
                },
                global,
                process,
                os,
                fs,
                path,
                axios,
                crypto,
                moment
            };
            
            const raw = vm.runInNewContext(
                `(async () => { return (${code}) })()`,
                sandbox,
                { timeout: 8000 }
            );
            result = await raw;
        } catch (e) {
            result = e.message;
            isError = true;
        }

        const elapsed = Date.now() - start;
        const label = isError ? '❌ ᴇʀʀᴏʀ' : '✅ ʀᴇsᴜʟᴛ';
        const output = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
        const trimmed = output.length > 3000 ? output.slice(0, 3000) + '\n...[truncated]' : output;

        await socket.sendMessage(sender, {
            text: `*${label}* (${elapsed}ms)\n\`\`\`\n${trimmed}\n\`\`\`\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}eval`, buttonText: { displayText: '⚡ ʀᴜɴ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: isError ? '❌' : '✅', key: msg.key } });

    } catch (err) {
        console.error('[Eval] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴇᴠᴀʟ ғᴀɪʟᴇᴅ*\n\n${err.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case translate
// Case: translate
case 'translate':
case 'tr': {
    try {
        if (args.length < 2) {
            return await socket.sendMessage(sender, {
                text: `❌ *Usage:* \`.translate <lang> <text>\`\n\n*Examples:*\n• \`.translate fr Hello world\`\n• \`.translate sw Good morning\`\n\n🌍 *Common Codes:*\n• fr - French\n• es - Spanish\n• de - German\n• ar - Arabic\n• sw - Swahili\n• zh - Chinese\n• ja - Japanese\n• pt - Portuguese\n• hi - Hindi\n• ru - Russian`,
                quoted: msg
            });
        }
        
        const targetLang = args[0].toLowerCase();
        const text = args.slice(1).join(' ');
        
        if (!text) {
            return await socket.sendMessage(sender, {
                text: `❌ Please provide text to translate!\n\n*Example:* \`.translate fr Hello world\``,
                quoted: msg
            });
        }
        
        await socket.sendMessage(sender, { react: { text: '🌍', key: msg.key } });
        
        const res = await axios.get('https://api.mymemory.translated.net/get', {
            params: { 
                q: text, 
                langpair: `en|${targetLang}` 
            },
            timeout: 10000
        });
        
        const translated = res.data?.responseData?.translatedText;
        
        if (!translated || res.data.responseStatus !== 200) {
            throw new Error('Translation failed');
        }
        
        const translationText = `🌍 *Translation*\n\n` +
            `📝 *Original (en):*\n${text}\n\n` +
            `✅ *Translated (${targetLang.toUpperCase()}):*\n${translated}\n\n` +
            `> ${config.BOT_FOOTER}`;
        
        await socket.sendMessage(sender, {
            text: translationText,
            quoted: msg
        });
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (error) {
        console.error('Translate error:', error);
        await socket.sendMessage(sender, {
            text: `❌ Translation failed! Check the language code and try again.\n\n*Common Codes:*\n• fr - French\n• es - Spanish\n• de - German\n• ar - Arabic\n• sw - Swahili\n• zh - Chinese\n• ja - Japanese\n• pt - Portuguese\n• hi - Hindi\n• ru - Russian\n\n*Usage:* \`.translate fr Hello world\``,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: welcome
case 'welcome': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }
        const settings = global.welcomeSettings.get(from) || { welcome: false, goodbye: false, customWelcome: '', customGoodbye: '' };
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'on') { settings.welcome = true; global.welcomeSettings.set(from, settings); await socket.sendMessage(sender, { text: `👋 *ᴡᴇʟᴄᴏᴍᴇ ᴏɴ*\n\n> ${config.BOT_FOOTER}`, quoted: msg }); break; }
        if (sub === 'off') { settings.welcome = false; global.welcomeSettings.set(from, settings); await socket.sendMessage(sender, { text: '👋 *ᴡᴇʟᴄᴏᴍᴇ ᴏғғ*', quoted: msg }); break; }
        await socket.sendMessage(sender, { text: `👋 *ᴡᴇʟᴄᴏᴍᴇ:* ${settings.welcome ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n\n> ${config.BOT_FOOTER}`, quoted: msg });
    } catch (e) { console.error('Welcome error:', e); }
    break;
}

// Case: goodbye
case 'goodbye': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }
        const settings = global.welcomeSettings.get(from) || { welcome: false, goodbye: false, customWelcome: '', customGoodbye: '' };
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'on') { settings.goodbye = true; global.welcomeSettings.set(from, settings); await socket.sendMessage(sender, { text: `👋 *ɢᴏᴏᴅʙʏᴇ ᴏɴ*\n\n> ${config.BOT_FOOTER}`, quoted: msg }); break; }
        if (sub === 'off') { settings.goodbye = false; global.welcomeSettings.set(from, settings); await socket.sendMessage(sender, { text: '👋 *ɢᴏᴏᴅʙʏᴇ ᴏғғ*', quoted: msg }); break; }
        await socket.sendMessage(sender, { text: `👋 *ɢᴏᴏᴅʙʏᴇ:* ${settings.goodbye ? '✅ ᴏɴ' : '❌ ᴏғғ'}\n\n> ${config.BOT_FOOTER}`, quoted: msg });
    } catch (e) { console.error('Goodbye error:', e); }
    break;
}

// Case: setwelcome
case 'setwelcome': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }
        const msg2 = args.join(' ').trim();
        if (!msg2) { await socket.sendMessage(sender, { text: `❌ ᴜsᴀɢᴇ: \`${prefix}setwelcome ᴡᴇʟᴄᴏᴍᴇ {name}! 🎉\``, quoted: msg }); break; }
        const settings = global.welcomeSettings.get(from) || { welcome: false, goodbye: false, customWelcome: '', customGoodbye: '' };
        settings.customWelcome = msg2; settings.welcome = true;
        global.welcomeSettings.set(from, settings);
        await socket.sendMessage(sender, { text: `✅ *ᴄᴜsᴛᴏᴍ ᴡᴇʟᴄᴏᴍᴇ sᴇᴛ!*\n\n${msg2}\n\n> ${config.BOT_FOOTER}`, quoted: msg });
    } catch (e) { console.error('Setwelcome error:', e); }
    break;
}

// Case: setgoodbye
case 'setgoodbye': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }
        const msg2 = args.join(' ').trim();
        if (!msg2) { await socket.sendMessage(sender, { text: `❌ ᴜsᴀɢᴇ: \`${prefix}setgoodbye ɢᴏᴏᴅʙʏᴇ {name}! 👋\``, quoted: msg }); break; }
        const settings = global.welcomeSettings.get(from) || { welcome: false, goodbye: false, customWelcome: '', customGoodbye: '' };
        settings.customGoodbye = msg2; settings.goodbye = true;
        global.welcomeSettings.set(from, settings);
        await socket.sendMessage(sender, { text: `✅ *ᴄᴜsᴛᴏᴍ ɢᴏᴏᴅʙʏᴇ sᴇᴛ!*\n\n${msg2}\n\n> ${config.BOT_FOOTER}`, quoted: msg });
    } catch (e) { console.error('Setgoodbye error:', e); }
    break;
}
                // Case: alive
                case 'uptime':
                case 'alive': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const captionText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*╭─────────────────⊷*
*┃* ʙᴏᴛ ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s
*┃* ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeSockets.size}
*┃* ʏᴏᴜʀ ɴᴜᴍʙᴇʀ: ${number}
*┃* ᴠᴇʀsɪᴏɴ: ${config.version}
*┃* ᴍᴏᴅᴇ: ${config.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC'}
*┃* ᴀɴᴛɪᴄᴀʟʟ: ${config.anticall ? '✅ ON' : '❌ OFF'}
*┃* ᴘʀᴇғɪx: ${config.PREFIX}
*┃* ᴍᴇᴍᴏʀʏ ᴜsᴀɢᴇ: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*╰───────────────┈⊷*

> *▫️ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴍᴀɪɴ*
> sᴛᴀᴛᴜs: ONLINE ✅
> ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms`;

                        const aliveMessage = {
                            image: { url: "https://i.ibb.co/gKnBmq8/casey.jpg" },
                            caption: `> ᴀᴍ ᴀʟɪᴠᴇ ɴ ᴋɪᴄᴋɪɴɢ 🥳\n\n${captionText}`,
                            buttons: [
                                {
                                    buttonId: `${config.PREFIX}menu_action`,
                                    buttonText: { displayText: '📂 ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ' },
                                    type: 4,
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify({
                                            title: 'ᴄʟɪᴄᴋ ʜᴇʀᴇ ❏',
                                            sections: [
                                                {
                                                    title: `ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`,
                                                    highlight_label: 'Quick Actions',
                                                    rows: [
                                                        { title: '📋 ғᴜʟʟ ᴍᴇɴᴜ', description: 'ᴠɪᴇᴡ ᴀʟʟ ᴀᴠᴀɪʟᴀʙʟᴇ ᴄᴍᴅs', id: `${config.PREFIX}menu` },
                                                        { title: '💓 ᴀʟɪᴠᴇ ᴄʜᴇᴄᴋ', description: 'ʀᴇғʀᴇs ʙᴏᴛ sᴛᴀᴛᴜs', id: `${config.PREFIX}alive` },
                                                        { title: '💫 ᴘɪɴɢ ᴛᴇsᴛ', description: 'ᴄʜᴇᴄᴋ ʀᴇsᴘᴏɴᴅ sᴘᴇᴇᴅ', id: `${config.PREFIX}ping` }
                                                    ]
                                                },
                                                {
                                                    title: "ϙᴜɪᴄᴋ ᴄᴍᴅs",
                                                    highlight_label: 'Popular',
                                                    rows: [
                                                        { title: '🤖 ᴀɪ ᴄʜᴀᴛ', description: 'Start AI conversation', id: `${config.PREFIX}ai Hello!` },
                                                        { title: '🎵 ᴍᴜsɪᴄ sᴇᴀʀᴄʜ', description: 'Download your favorite songs', id: `${config.PREFIX}song` },
                                                        { title: '📰 ʟᴀᴛᴇsᴛ ɴᴇᴡs', description: 'Get current news updates', id: `${config.PREFIX}news` }
                                                    ]
                                                }
                                            ]
                                        })
                                    }
                                },
                                { buttonId: `${config.PREFIX}session`, buttonText: { displayText: '🌟 ʙᴏᴛ ɪɴғᴏ' }, type: 1 },
                                { buttonId: `${config.PREFIX}active`, buttonText: { displayText: '📈 ʙᴏᴛ sᴛᴀᴛs' }, type: 1 }
                            ],
                            headerType: 1,
                            viewOnce: true,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363420261263259@newsletter',
                                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                                    serverMessageId: -1
                                }
                            }
                        };

                        await socket.sendMessage(m.chat, aliveMessage, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Alive command error:', error);
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const errorMessage = {
                            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
                            caption: `*🤖 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ᴀʟɪᴠᴇ*\n\n` +
                                    `*╭─────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*\n` +
                                    `*┃* ᴜᴘᴛɪᴍᴇ: ${hours}h ${minutes}m ${seconds}s\n` +
                                    `*┃* sᴛᴀᴛᴜs: ᴏɴʟɪɴᴇ\n` +
                                    `*┃* ɴᴜᴍʙᴇʀ: ${number}\n` +
                                    `*┃* ᴍᴏᴅᴇ: ${config.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC'}\n` +
                                    `*┃* ᴀɴᴛɪᴄᴀʟʟ: ${config.anticall ? '✅ ON' : '❌ OFF'}\n` +
                                    `*┃* ᴘʀᴇғɪx: ${config.PREFIX}\n` +
                                    `*╰──────────────⊷*\n\n` +
                                    `Type *${config.PREFIX}menu* for commands`,
                            contextInfo: {
                                forwardingScore: 1,
                                isForwarded: true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid: '120363420261263259@newsletter',
                                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                                    serverMessageId: -1
                                }
                            }
                        };

                        await socket.sendMessage(m.chat, errorMessage, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: groupstatus
         // Case: groupstatus / ginfo / groupinfo / grpinfo / gstatus - Show group info
case 'groupstatus':
case 'ginfo':
case 'groupinfo':
case 'grpinfo':
case 'gstatus': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *Group Only Command*\n\nThis command can only be used in groups.',
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📊', key: msg.key } });

        let meta;
        try {
            meta = await socket.groupMetadata(from);
        } catch {
            await socket.sendMessage(sender, {
                text: '❌ Could not fetch group information.',
                quoted: msg
            });
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            break;
        }

        const participants = meta.participants || [];
        const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
        const superAdmins = participants.filter(p => p.admin === 'superadmin');
        const members = participants.filter(p => !p.admin);

        const createdAt = meta.creation
            ? new Date(meta.creation * 1000).toLocaleString('en-US', {
                day: 'numeric', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
                timeZone: 'Africa/Nairobi'
              })
            : 'Unknown';

        const ownerNum = meta.owner 
            ? meta.owner.split('@')[0] 
            : superAdmins[0]?.id.split('@')[0] || 'Unknown';

        let inviteLink = '';
        try {
            const code = await socket.groupInviteCode(from);
            inviteLink = `https://chat.whatsapp.com/${code}`;
        } catch { 
            inviteLink = 'Not available (Admin only)';
        }

        const desc = meta.desc
            ? `\n📄 *Description:*\n${meta.desc.trim().substring(0, 200)}${meta.desc.trim().length > 200 ? '...' : ''}`
            : '';

        const announce = meta.announce ? '🔒 Admins only' : '🌐 All members';
        const restrict = meta.restrict ? '🔒 Admins only' : '🌐 All members';
        const ephemeral = meta.ephemeral
            ? `${meta.ephemeral / 86400} days`
            : '❌ Off';

        const infoText =
            `╔══════════════════╗\n` +
            `  📊 *GROUP INFORMATION*\n` +
            `╚══════════════════╝\n\n` +
            `🏷️ *Name:* ${meta.subject || 'N/A'}\n` +
            `🆔 *ID:* \`${from.split('@')[0]}\`\n` +
            `👑 *Owner:* @${ownerNum}\n` +
            `📅 *Created:* ${createdAt}\n` +
            `${desc}\n` +
            `\n👥 *Members:* ${participants.length}\n` +
            `   ├ 👑 Super Admins: ${superAdmins.length}\n` +
            `   ├ 🛡️ Admins: ${admins.length}\n` +
            `   └ 👤 Members: ${members.length}\n` +
            `\n⚙️ *Settings:*\n` +
            `   ├ 💬 Messages: ${announce}\n` +
            `   ├ ✏️ Edit Info: ${restrict}\n` +
            `   └ ⏳ Disappearing: ${ephemeral}\n` +
            `\n🔗 *Invite:* ${inviteLink}\n\n` +
            `> ${config.BOT_FOOTER}`;

        const mentions = [meta.owner, ...superAdmins.map(p => p.id)].filter(Boolean);

        // Build buttons
        const buttons = [];
        
        if (inviteLink && inviteLink.startsWith('https://')) {
            buttons.push({
                buttonId: inviteLink,
                buttonText: { displayText: '🔗 INVITE LINK' },
                type: 1
            });
        }
        
        buttons.push({
            buttonId: `${prefix}tagall`,
            buttonText: { displayText: '👥 TAG ALL' },
            type: 1
        });
        
        buttons.push({
            buttonId: `${prefix}tagadmins`,
            buttonText: { displayText: '🛡️ TAG ADMINS' },
            type: 1
        });

        // Try to send with group icon
        try {
            const pp = await socket.profilePictureUrl(from, 'image');
            await socket.sendMessage(sender, {
                image: { url: pp },
                caption: infoText,
                mentions: mentions,
                buttons: buttons,
                headerType: 1
            }, { quoted: msg });
        } catch {
            // Send without group icon
            await socket.sendMessage(sender, {
                text: infoText,
                mentions: mentions,
                buttons: buttons,
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('GroupStatus error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error fetching group info*\n\n${error.message}`,
            buttons: [
                { buttonId: `${prefix}gstatus`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: togstatus / swgc / groupstatus - Send text/image/video/audio as group status
case 'togstatus':
case 'swgc':
case 'groupstatus': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        // Parse args: caption|color|groupUrl
        const raw = args.join(' ').trim();
        let [caption, color, groupUrl] = raw.split('|').map(v => v?.trim());

        // Resolve target group
        let targetGroupId = from;
        if (groupUrl) {
            try {
                const code = groupUrl.split('/').pop().split('?')[0];
                const info = await socket.groupGetInviteInfo(code);
                targetGroupId = info.id;
            } catch {
                await socket.sendMessage(sender, {
                    text: '❌ ɪɴᴠᴀʟɪᴅ ɢʀᴏᴜᴘ ʟɪɴᴋ ᴏʀ ʙᴏᴛ ɪs ɴᴏᴛ ɪɴ ᴛʜᴀᴛ ɢʀᴏᴜᴘ.',
                    quoted: msg
                });
                break;
            }
        }

        // Detect quoted message
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
            (msg.message?.imageMessage ? msg.message : null) ||
            (msg.message?.videoMessage ? msg.message : null) ||
            (msg.message?.audioMessage ? msg.message : null);

        // Color map
        const COLORS = {
            blue: '#34B7F1',
            green: '#25D366',
            yellow: '#FFD700',
            orange: '#FF8C00',
            red: '#FF3B30',
            purple: '#9C27B0',
            gray: '#9E9E9E',
            black: '#000000',
            white: '#FFFFFF',
            cyan: '#00BCD4'
        };

        const hasMedia = quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage);

        // ── TEXT STATUS ──
        if (!hasMedia) {
            if (!caption) {
                await socket.sendMessage(sender, {
                    text: `📝 *ɢʀᴏᴜᴘ sᴛᴀᴛᴜs*\n\n` +
                          `• \`${prefix}togstatus caption|color\`\n` +
                          `• \`${prefix}togstatus |blue\`\n` +
                          `• ʀᴇᴘʟʏ ᴛᴏ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ/ᴀᴜᴅɪᴏ\n\n` +
                          `🎨 *ᴄᴏʟᴏʀs:* blue, green, yellow, orange, red, purple, gray, black, white, cyan\n\n` +
                          `> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            const bgHex = COLORS[color?.toLowerCase()] || COLORS.blue;

            await groupStatus(socket, targetGroupId, {
                extendedTextMessage: {
                    text: caption,
                    backgroundArgb: hexToArgb(bgHex),
                    font: 0
                }
            });

            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📤', key: msg.key } });

        // ── IMAGE STATUS ──
        if (quoted.imageMessage) {
            const mediaMsg = quoted.imageMessage || quoted;
            const stream = await downloadContentFromMessage(mediaMsg, 'image');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const content = await generateWAMessageContent(
                { image: buffer, caption: caption || '' },
                { upload: socket.waUploadToServer }
            );
            await groupStatus(socket, targetGroupId, content);
            await socket.sendMessage(sender, {
                text: '✅ *ɪᴍᴀɢᴇ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: msg
            });
        }

        // ── VIDEO STATUS ──
        else if (quoted.videoMessage) {
            const mediaMsg = quoted.videoMessage || quoted;
            const stream = await downloadContentFromMessage(mediaMsg, 'video');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const content = await generateWAMessageContent(
                { video: buffer, caption: caption || '' },
                { upload: socket.waUploadToServer }
            );
            await groupStatus(socket, targetGroupId, content);
            await socket.sendMessage(sender, {
                text: '✅ *ᴠɪᴅᴇᴏ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: msg
            });
        }

        // ── AUDIO STATUS ──
        else if (quoted.audioMessage) {
            const mediaMsg = quoted.audioMessage || quoted;
            const stream = await downloadContentFromMessage(mediaMsg, 'audio');
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

            const vn = await toVN(buffer);
            const waveform = await generateWaveform(buffer);

            const content = await generateWAMessageContent(
                { audio: vn, mimetype: 'audio/ogg; codecs=opus', ptt: true },
                { upload: socket.waUploadToServer }
            );

            if (content.audioMessage) {
                content.audioMessage.waveform = Buffer.from(waveform, 'base64');
            }

            await groupStatus(socket, targetGroupId, content);
            await socket.sendMessage(sender, {
                text: '✅ *ᴀᴜᴅɪᴏ sᴛᴀᴛᴜs sᴇɴᴛ!*',
                quoted: msg
            });
        }

        else {
            await socket.sendMessage(sender, {
                text: '❌ ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ. ʀᴇᴘʟʏ ᴛᴏ ᴀɴ ɪᴍᴀɢᴇ, ᴠɪᴅᴇᴏ, ᴏʀ ᴀᴜᴅɪᴏ.',
                quoted: msg
            });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[togstatus]', err);
        await socket.sendMessage(sender, {
            text: `❌ *sᴛᴀᴛᴜs ᴇʀʀᴏʀ:* ${err.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: mediafire / mf / mfdl - Get MediaFire direct download link
case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const url = args[0];
        
        if (!url || !url.includes('mediafire.com')) {
            await socket.sendMessage(sender, {
                text: `📁 *MediaFire Downloader*\n\nExtract direct download links from MediaFire.\n\n*Usage:* \`${prefix}mf <mediafire_url>\`\n\n*Example:*\n\`${prefix}mf https://www.mediafire.com/file/abc123/filename.zip/file\``,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📁', key: msg.key } });

        // Send processing message
        await socket.sendMessage(sender, {
            text: '⏳ *Extracting MediaFire link...*',
            quoted: msg
        });

        const { data } = await axios.get(url, {
            timeout: 15000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });

        // Try multiple patterns to find download link
        let dlUrl = '';
        let fileName = 'file';

        // Pattern 1: Direct download link
        const match1 = data.match(/href="(https:\/\/download\d+\.mediafire\.com[^"]+)"/);
        if (match1) dlUrl = match1[1];

        // Pattern 2: Alternative download link
        if (!dlUrl) {
            const match2 = data.match(/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/i);
            if (match2) dlUrl = match2[1];
        }

        // Pattern 3: Another format
        if (!dlUrl) {
            const match3 = data.match(/(https:\/\/download\d+\.mediafire\.com\/[^\s"']+)/i);
            if (match3) dlUrl = match3[1];
        }

        if (!dlUrl) {
            throw new Error('Could not extract download link. File may be removed or private.');
        }

        // Try multiple patterns for filename
        const nameMatch1 = data.match(/<div class="filename">([^<]+)<\/div>/);
        const nameMatch2 = data.match(/class="dl-btn-label[^"]*">([^<]+)<\/span>/);
        const nameMatch3 = data.match(/<title>([^<]+)<\/title>/);
        
        if (nameMatch1) fileName = nameMatch1[1].trim();
        else if (nameMatch2) fileName = nameMatch2[1].trim();
        else if (nameMatch3) fileName = nameMatch3[1].trim().replace('MediaFire', '').replace(/[-–—]/g, '').trim();

        // Clean up filename
        fileName = fileName.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

        await socket.sendMessage(sender, {
            text: `📁 *MediaFire Download*\n\n` +
                  `📄 *File:* ${fileName}\n` +
                  `🔗 *Link:* ${dlUrl}\n\n` +
                  `> ${config.BOT_FOOTER}`,
            quoted: msg
        });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[MediaFire] Error:', error.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *MediaFire Failed*\n\n${error.message}\n\n*Tips:*\n• Make sure the file is public\n• Check if the link is valid\n• File may have been removed`,
            quoted: msg
        });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: tourl / imgtourl / imgurl / geturl / upload - Upload media to Catbox
case 'tourl':
case 'imgtourl':
case 'imgurl':
case 'geturl':
case 'upload': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        // Prefer quoted message, fall back to direct message
        const source = quoted || msg.message;
        
        if (!source) {
            await socket.sendMessage(sender, {
                text: '❌ *Upload to URL*\n\nReply to an image, video, audio, or document to upload it.\n\n*Usage:* Reply to media with `.tourl`',
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        // Determine media type
        let mediaContent = null;
        let mediaType = '';
        let mimeType = '';

        if (source.imageMessage) {
            mediaContent = source.imageMessage;
            mediaType = 'image';
            mimeType = mediaContent.mimetype || 'image/jpeg';
        } else if (source.videoMessage) {
            mediaContent = source.videoMessage;
            mediaType = 'video';
            mimeType = mediaContent.mimetype || 'video/mp4';
        } else if (source.audioMessage) {
            mediaContent = source.audioMessage;
            mediaType = 'audio';
            mimeType = mediaContent.mimetype || 'audio/mpeg';
        } else if (source.documentMessage) {
            mediaContent = source.documentMessage;
            mediaType = 'document';
            mimeType = mediaContent.mimetype || 'application/octet-stream';
        } else if (source.stickerMessage) {
            mediaContent = source.stickerMessage;
            mediaType = 'sticker';
            mimeType = 'image/webp';
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Unsupported Media*\n\nPlease reply to an image, video, audio, or document.',
                buttons: [
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        // Send processing reaction
        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        // Send uploading message
        const uploadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Uploading to Catbox...*\n\nPlease wait...',
            quoted: msg
        });

        let tempPath = null;
        
        // Download media
        const stream = await downloadContentFromMessage(mediaContent, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Determine file extension
        let ext = '';
        if (mimeType.includes('image/jpeg') || mimeType.includes('image/jpg')) ext = '.jpg';
        else if (mimeType.includes('image/png')) ext = '.png';
        else if (mimeType.includes('image/webp')) ext = '.webp';
        else if (mimeType.includes('video/mp4')) ext = '.mp4';
        else if (mimeType.includes('video')) ext = '.mp4';
        else if (mimeType.includes('audio/mpeg') || mimeType.includes('audio/mp3')) ext = '.mp3';
        else if (mimeType.includes('audio/ogg')) ext = '.ogg';
        else if (mimeType.includes('audio')) ext = '.mp3';
        else if (mimeType.includes('pdf')) ext = '.pdf';
        else ext = '.bin';

        // Save temp file
        tempPath = path.join(TEMP_MEDIA_DIR, `catbox_${Date.now()}${ext}`);
        await writeFile(tempPath, buffer);

        // Upload to Catbox
        const form = new FormData();
        form.append('fileToUpload', fs.createReadStream(tempPath), `file${ext}`);
        form.append('reqtype', 'fileupload');

        const { data: mediaUrl } = await axios.post('https://catbox.moe/user/api.php', form, {
            headers: form.getHeaders(),
            timeout: 30000
        });

        // Delete uploading message
        try { await socket.sendMessage(sender, { delete: uploadingMsg.key }); } catch {}

        if (!mediaUrl || mediaUrl.toLowerCase().includes('error')) {
            throw new Error('Catbox returned an error: ' + mediaUrl);
        }

        // Format size
        const sizeStr = buffer.length < 1048576
            ? `${(buffer.length / 1024).toFixed(1)} KB`
            : `${(buffer.length / 1048576).toFixed(2)} MB`;

        // Determine media label
        const label = mimeType.includes('image') ? '🖼️ Image'
            : mimeType.includes('video') ? '🎬 Video'
            : mimeType.includes('audio') ? '🎵 Audio'
            : mimeType.includes('pdf') ? '📄 Document'
            : '📁 File';

        // Send result with buttons
        await socket.sendMessage(sender, {
            text: `☁️ *Upload Complete!*\n\n` +
                  `${label}\n` +
                  `📦 *Size:* ${sizeStr}\n` +
                  `🔗 *URL:* ${mediaUrl}\n\n` +
                  `> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: mediaUrl, buttonText: { displayText: '🔗 OPEN URL' }, type: 1 },
                { buttonId: `${prefix}tourl`, buttonText: { displayText: '📤 UPLOAD MORE' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        // Clean up temp file
        if (tempPath && fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
        }

    } catch (err) {
        console.error('[Upload] Error:', err.message);
        
        try {
            // Delete uploading message if it exists
            // The uploadingMsg might not be in scope here, so we skip deletion
        } catch {}
        
        await socket.sendMessage(sender, {
            text: `⚠️ *Upload Failed*\n\n${err.message}\n\nMake sure you're replying to a valid media file.`,
            buttons: [
                { buttonId: `${prefix}tourl`, buttonText: { displayText: '🔄 RETRY' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        // Clean up temp file on error
        // tempPath cleanup is handled if it exists
    }
    break;
}
///xoding case 
// Case: color
case 'color': {
    try {
        // React to the command
        await socket.sendMessage(sender, {
            react: {
                text: "🎨",
                key: msg.key
            }
        });

        const colorNames = [
            "Red", "Green", "Blue", "Yellow", "Orange", "Purple", "Pink", "Brown", 
            "Black", "White", "Gray", "Cyan", "Magenta", "Violet", "Indigo", 
            "Teal", "Lavender", "Turquoise", "Coral", "Maroon", "Navy", "Olive",
            "Lime", "Aqua", "Fuchsia", "Silver", "Gold", "Plum", "Orchid"
        ];
        
        // Generate random color with proper hex formatting
        const randomColorHex = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
        const randomColorName = colorNames[Math.floor(Math.random() * colorNames.length)];

        // Create a colored text message using the random color
        const colorMessage = `🎨 *Random Color Generator*\n\n` +
                            `*Color Name:* ${randomColorName}\n` +
                            `*Hex Code:* ${randomColorHex}\n` +
                            `*RGB:* ${hexToRgb(randomColorHex)}\n\n` +
                            `╭━━━━━━━━━━━━━━━━━━╮\n` +
                            `┃ 🎨 *Preview:*\n` +
                            `┃ ${getColorPreview(randomColorName)}\n` +
                            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                            `> _Generated by CaseyRhodes Tech_`;

        await socket.sendMessage(sender, {
            text: colorMessage,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363302677217436@newsletter',
                    newsletterName: 'CASEYRHODES TECH',
                    serverMessageId: 143
                }
            }
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error('Color command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error generating color:* ${error.message}`,
            quoted: fakevCard
        });
    }
    break;
}

// Helper functions to add at the top of your file (after other helper functions)
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace(/^#/, '');
    
    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r}, ${g}, ${b}`;
}

function getColorPreview(colorName) {
    // Create a visual preview using colored squares (emoji-based)
    const colorEmojis = {
        "Red": "🟥", "Green": "🟩", "Blue": "🟦", "Yellow": "🟨",
        "Orange": "🟧", "Purple": "🟪", "Pink": "🌸", "Brown": "🟫",
        "Black": "⬛", "White": "⬜", "Gray": "◻️", "Cyan": "💙",
        "Magenta": "💜", "Violet": "🟣", "Indigo": "🔵", "Teal": "💚",
        "Lavender": "🟪", "Turquoise": "💎", "Coral": "🧡", "Maroon": "❤️",
        "Navy": "💙", "Olive": "🫒", "Lime": "💚", "Aqua": "💦",
        "Fuchsia": "🌸", "Silver": "⚪", "Gold": "⭐", "Plum": "🟣",
        "Orchid": "🌸"
    };
    
    const emoji = colorEmojis[colorName] || "🎨";
    return `${emoji} ${colorName} ${emoji}`;
}

case 'base64':
case 'encode': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "🔐",
            key: msg.key
        }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const textToEncode = args.join(' ');

    if (!textToEncode) {
        return await socket.sendMessage(sender, {
            text: '🔐 *Base64 Encoder*\n\n' +
                  'Please provide text to encode.\n' +
                  'Example: *.base64 Hello World*',
            buttons: [
                { buttonId: '.base64 Hello World', buttonText: { displayText: '🔐 Example' }, type: 1 },
                { buttonId: '.help base64', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        const encodedText = Buffer.from(textToEncode).toString('base64');
        
        await socket.sendMessage(sender, {
            text: `🔐 *Base64 Encoded Text*\n\n` +
                  `*Original:* ${textToEncode}\n` +
                  `*Encoded:* ${encodedText}\n\n` +
                  `> _Encoded by CaseyRhodes Tech_`,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363302677217436@newsletter',
                    newsletterName: 'CASEYRHODES TECH',
                    serverMessageId: 143
                }
            },
            buttons: [
                { buttonId: `.unbase64 ${encodedText}`, buttonText: { displayText: '🔓 Decode' }, type: 1 },
                { buttonId: '.base64', buttonText: { displayText: '🔄 New Encode' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (e) {
        console.error('[BASE64 ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ *Error encoding text!*\n\n' +
                  'Please try again with different text.',
            buttons: [
                { buttonId: '.base64', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}

case 'unbase64':
case 'decode':
case 'deb64': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "🔓",
            key: msg.key
        }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const base64Text = args.join(' ');

    if (!base64Text) {
        return await socket.sendMessage(sender, {
            text: '🔓 *Base64 Decoder*\n\n' +
                  'Please provide Base64 text to decode.\n' +
                  'Example: *.unbase64 SGVsbG8gV29ybGQ=*',
            buttons: [
                { buttonId: '.unbase64 SGVsbG8gV29ybGQ=', buttonText: { displayText: '🔓 Example' }, type: 1 },
                { buttonId: '.help unbase64', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        // Check if it's valid base64
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Text)) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid Base64 Format!*\n\n' +
                      'Please provide valid Base64 encoded text.',
                buttons: [
                    { buttonId: '.unbase64', buttonText: { displayText: '🔄 Try Again' }, type: 1 },
                    { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const decodedText = Buffer.from(base64Text, 'base64').toString('utf-8');
        
        // Check if decoding was successful
        if (!decodedText || decodedText.trim() === '') {
            throw new Error('Empty result after decoding');
        }

        await socket.sendMessage(sender, {
            text: `🔓 *Base64 Decoded Text*\n\n` +
                  `*Encoded:* ${base64Text}\n` +
                  `*Decoded:* ${decodedText}\n\n` +
                  `> _Decoded by CaseyRhodes Tech_`,
            contextInfo: {
                mentionedJid: [sender],
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363302677217436@newsletter',
                    newsletterName: 'CASEYRHODES TECH',
                    serverMessageId: 143
                }
            },
            buttons: [
                { buttonId: `.base64 ${decodedText}`, buttonText: { displayText: '🔐 Encode' }, type: 1 },
                { buttonId: '.unbase64', buttonText: { displayText: '🔄 New Decode' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (e) {
        console.error('[UNBASE64 ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ *Error decoding text!*\n\n' +
                  'Please check if the Base64 text is valid.',
            buttons: [
                { buttonId: '.unbase64', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
// Take Command - Case Command Format (Steal a sticker and re-pack)
// Add this case inside your switch(command) { statement

// Case: take - Steal sticker and repack
case 'take':
case 'steal': {
    try {
        let targetMessage = msg;
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        
        if (ctxInfo?.quotedMessage) {
            targetMessage = {
                key: { 
                    remoteJid: from, 
                    id: ctxInfo.stanzaId, 
                    participant: ctxInfo.participant 
                },
                message: ctxInfo.quotedMessage,
            };
        }
        
        const stickerMsg = targetMessage.message?.stickerMessage;
        
        if (!stickerMsg) {
            await socket.sendMessage(sender, {
                text: `🎭 *Steal Sticker*\n\n┏━━━━━━━━━━━━━━━━━━━━━━━━┓\n┃ 📌 *How to use:*\n┃\n┃ 1️⃣ Reply to a sticker\n┃ 2️⃣ Type: ${prefix}take [packname]\n┃\n┃ *Example:*\n┃ ${prefix}take CaseyBot\n┗━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n> *CaseyRhodes Bot*`,
                quoted: msg
            });
            break;
        }
        
        await socket.sendMessage(sender, { react: { text: '🎭', key: msg.key } });
        
        const mediaBuffer = await downloadMediaMessage(
            targetMessage,
            'buffer',
            {},
            { logger: undefined, reuploadRequest: socket.updateMediaMessage }
        );
        
        if (!mediaBuffer) {
            await socket.sendMessage(sender, { text: '❌ Failed to download sticker. Please try again.' }, { quoted: msg });
            break;
        }
        
        const userName = msg.pushName || senderNumber;
        const packname = args.length ? args.join(' ') : userName;
        
        const img = new webp.Image();
        await img.load(mediaBuffer);
        
        const json = {
            'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
            'sticker-pack-name': packname,
            'sticker-pack-publisher': config.OWNER_NAME,
            emojis: ['🤖', '🎭', '💫']
        };
        
        const exifAttr = Buffer.from([
            0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
            0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
        ]);
        
        const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
        const exif = Buffer.concat([exifAttr, jsonBuffer]);
        exif.writeUIntLE(jsonBuffer.length, 14, 4);
        
        img.exif = exif;
        const finalBuffer = await img.save(null);
        
        await socket.sendMessage(sender, { sticker: finalBuffer }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (error) {
        console.error('Take command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ Failed to steal sticker. Please try again.',
            quoted: msg
        });
    }
    break;
}
// Case: bot_stats
// Case: bot_stats
case 'session': {
    try {
        const from = m.key.remoteJid;
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const activeCount = activeSockets.size;

        const captionText = `*╭──────────────⊷*
*┃* Uptime: ${hours}h ${minutes}m ${seconds}s
*┃* Memory: ${usedMemory}MB / ${totalMemory}MB
*┃* Active Users: ${activeCount}
*┃* Your Number: ${number}
*┃* Version: ${config.version}
*╰──────────────⊷*`;

        // Create single message with image and newsletter context
        const statsMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'POWERED BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(from, statsMessage, { 
            quoted: m
        });
    } catch (error) {
        console.error('Bot stats error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { 
            text: '❌ Failed to retrieve stats. Please try again later.' 
        }, { quoted: m });
    }
    break;
}
// Case: bot_info
case 'info': {
    try {
        const from = m.key.remoteJid;
        const captionText = `*╭───────────────⊷*
*┃*  👤 ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ
*┃*  🇰🇪 ᴄʀᴇᴀᴛᴏʀ: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃*  🌐 ᴠᴇʀsɪᴏɴ: ${config.version}
*┃*  📍 ᴘʀᴇғɪx: ${config.PREFIX}
*┃*  📖 ᴅᴇsᴄ: ʏᴏᴜʀ sᴘɪᴄʏ, ʟᴏᴠɪɴɢ ᴡʜᴀᴛsᴀᴘᴘ ᴄᴏᴍᴘᴀɴɪᴏɴ 😘
*╰──────────────⊷*`;
        
        // Create single message with image and newsletter context
        const infoMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: captionText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'MINI BOT BY CASEYRHODES TECH',
                    serverMessageId: -1
                }
            }
        };
        
        await socket.sendMessage(from, infoMessage, { quoted: m });
    } catch (error) {
        console.error('Bot info error:', error);
        const from = m.key.remoteJid;
        await socket.sendMessage(from, { text: '❌ Failed to retrieve bot info.' }, { quoted: m });
    }
    break;
}
// Case: menu
case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    
    let menuText = `*╭─────────────────⊷*  
*┃* *🌟ʙᴏᴛ ɴᴀᴍᴇ*: ᴄᴀsᴇʀʜᴏᴅᴇs ᴍɪɴɪ
*┃* *🌸ᴜsᴇʀ*: ɢᴜᴇsᴛ
*┃* *📍ᴘʀᴇғɪx*: .
*┃* *⏰ᴜᴘᴛɪᴍᴇ* : ${hours}h ${minutes}m ${seconds}s
*┃* *📂sᴛᴏʀᴀɢᴇ* : ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃* *🎭ᴅᴇᴠ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ
*╰──────────────────⊷*
*\`Ξ ѕєlєct α cαtєgσrч вєlσw:\`*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ ッ
`;
    const messageContext = {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363408915265322@newsletter',
            newsletterName: '͏ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            serverMessageId: -1
        }
    };

    const menuMessage = {
      image: { url: "https://i.ibb.co/gKnBmq8/casey.jpg" },
      caption: `*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*\n${menuText}`,
      buttons: [
        {
          buttonId: `${config.PREFIX}quick_commands`,
          buttonText: { displayText: '👑 CHOOSE CATEGORY' },
          type: 4,
          nativeFlowInfo: {
            name: 'single_select',
            paramsJson: JSON.stringify({
              title: '👑 CHOOSE CATEGORY',
              sections: [
                {
                  title: "🌐 ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs",
                  highlight_label: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ',
                  rows: [
                    { title: "📜 ᴀʟʟᴍᴇɴᴜ", description: "get all command in list", id: `${config.PREFIX}allmenu` }, 
                    { title: "🎨 ʟᴏɢᴏ ᴍᴇɴᴜ", description: "get your own logo texts", id: `${config.PREFIX}logomenu` }, 
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "Check if bot is active", id: `${config.PREFIX}alive` }, 
                       { title: "🤖 Settings", description: "change your setting on and off", id: `${config.PREFIX}settings` },
                    { title: "♻️ᴀᴜᴛᴏʙɪᴏ", description: "set your bio on and off", id: `${config.PREFIX}autobio` },
                    { title: "🪀MODE", description: "set your bot public or private", id: `${config.PREFIX}mode` },    
                    { title: "🌟owner", description: "get in touch with dev", id: `${config.PREFIX}owner` },
                    { title: "🎭ʜᴀᴄᴋ", description: "prank others", id: `${config.PREFIX}hack` },
                    { title: "🗣️ᴄᴀʟᴄᴜʟᴀᴛᴏʀ", description: "do your own math", id: `${config.PREFIX}calculator` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "View bot statistics", id: `${config.PREFIX}session` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "Get bot information", id: `${config.PREFIX}active` },
                    { title: "🔰sᴇᴛᴘᴘ", description: "set your own profile", id: `${config.PREFIX}setpp` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                    { title: "📜 ϙᴜʀᴀɴ", description: "List all your quran by number", id: `${config.PREFIX}quran` },
                    { title: "🔮sᴄʀᴇᴇɴsʜᴏᴏᴛ", description: "get website screenshots", id: `${config.PREFIX}ss` },
                    { title: "💌ғᴇᴛᴄʜ", description: "get url content", id: `${config.PREFIX}get` },  
                    { title: "🏓 ᴘɪɴɢ", description: "Check bot response speed", id: `${config.PREFIX}ping` },
                    { title: "📜 ᴘᴅғ", description: "change text to pdf", id: `${config.PREFIX}pdf` },
                    { title: "🔗 ᴘᴀɪʀ", description: "Generate pairing code", id: `${config.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "Fancy text generator", id: `${config.PREFIX}fancy` },
                    { title: "🔮tts", description: "voice converter", id: `${config.PREFIX}tts` },
                    { title: "🎉ɪᴍᴀɢᴇ", description: "random image generator", id: `${config.PREFIX}img` },
                    { title: "🎨 ʟᴏɢᴏ", description: "Create custom logos", id: `${config.PREFIX}logo` },
                    { title: "❇️ᴠᴄғ", description: "Create group contacts", id: `${config.PREFIX}vcf` },
                    { title: "📦 ʀᴇᴘᴏ", description: "Bot repository info", id: `${config.PREFIX}repo` },
                    { title: "📦 ɢɪᴛᴄʟᴏɴᴇ", description: "Download GitHub repos", id: `${config.PREFIX}gitclone` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "Download music from YouTube", id: `${config.PREFIX}song` }, 
                    { title: "🎀play", description: "play favourite songs", id: `${config.PREFIX}play` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "Download TikTok videos", id: `${config.PREFIX}tiktok` },
                    { title: "🎵 sʜᴀᴢᴀᴍ", description: "Identify songs from audio", id: `${config.PREFIX}shazam` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "Download Facebook content", id: `${config.PREFIX}fb` },
                    { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "Download Instagram content", id: `${config.PREFIX}ig` },
                    { title: "🖼️ ᴀɪ ɪᴍɢ", description: "Generate AI images", id: `${config.PREFIX}aiimg` },
                    { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "Access view-once media", id: `${config.PREFIX}viewonce` },
                    { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "Convert image/video to sticker", id: `${config.PREFIX}sticker` },
                    { title: "📤 ᴛᴏᴜʀʟ", description: "Upload media to URL", id: `${config.PREFIX}tourl` },
                    { title: "📁 ᴍᴇᴅɪᴀғɪʀᴇ", description: "Get MediaFire download link", id: `${config.PREFIX}mf` }
                  ]
                },
                {
                  title: "🫂 ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs",
                  highlight_label: 'Popular',
                  rows: [
                    { title: "➕ ᴀᴅᴅ", description: "Add Numbers to Group", id: `${config.PREFIX}add` },
                    { title: "🦶 ᴋɪᴄᴋ", description: "Remove Number from Group", id: `${config.PREFIX}kick` },
                    { title: "🔓 ᴏᴘᴇɴ", description: "Open Lock GROUP", id: `${config.PREFIX}open` },
                    { title: "🔒 ᴄʟᴏsᴇ", description: "Close Group", id: `${config.PREFIX}close` },
                    { title: "👑 ᴘʀᴏᴍᴏᴛᴇ", description: "Promote Member to Admin", id: `${config.PREFIX}promote` },
                    { title: "😢 ᴅᴇᴍᴏᴛᴇ", description: "Demote Member from Admin", id: `${config.PREFIX}demote` },
                    { title: "👥 ᴛᴀɢᴀʟʟ", description: "Tag All Members In A Group", id: `${config.PREFIX}tagall` },
                    { title: "👤 ᴊᴏɪɴ", description: "Join A Group", id: `${config.PREFIX}join` },
                    { title: "📊 ɢʀᴏᴜᴘ ɪɴғᴏ", description: "View group statistics & info", id: `${config.PREFIX}ginfo` },
                    { title: "👥 ᴍᴇᴍʙᴇʀs", description: "List all group members", id: `${config.PREFIX}members` },
                    { title: "📢 ɢʀᴏᴜᴘsᴛᴀᴛᴜs", description: "Post group status", id: `${config.PREFIX}togstatus` }
                  ]
                },
                {
                  title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                  rows: [
                    { title: "📰 ɴᴇᴡs", description: "Get latest news updates", id: `${config.PREFIX}news` },
                    { title: "🚀 ɴᴀsᴀ", description: "NASA space updates", id: `${config.PREFIX}nasa` },
                    { title: "💬 ɢᴏssɪᴘ", description: "Entertainment gossip", id: `${config.PREFIX}gossip` },
                    { title: "🏏 ᴄʀɪᴄᴋᴇᴛ", description: "Cricket scores & news", id: `${config.PREFIX}cricket` },
                    { title: "🌍 ᴄᴏᴜɴᴛʀʏ ɪɴғᴏ", description: "Get country details & stats", id: `${config.PREFIX}country` },
                    { title: "🕐 ᴛɪᴍᴇ", description: "Check time in any city", id: `${config.PREFIX}time` }
                  ]
                },
                {
                  title: "🖤 ʀᴏᴍᴀɴᴛɪᴄ, sᴀᴠᴀɢᴇ & ᴛʜɪɴᴋʏ",
                  highlight_label: 'Fun',
                  rows: [
                    { title: "😂 ᴊᴏᴋᴇ", description: "Hear a lighthearted joke", id: `${config.PREFIX}joke` },
                    { title: "🌚 ᴅᴀʀᴋ ᴊᴏᴋᴇ", description: "Get a dark humor joke", id: `${config.PREFIX}darkjoke` },
                    { title: "🏏 ᴡᴀɪғᴜ", description: "Get a random anime waifu", id: `${config.PREFIX}waifu` },
                    { title: "😂 ᴍᴇᴍᴇ", description: "Receive a random meme", id: `${config.PREFIX}meme` },
                    { title: "🐈 ᴄᴀᴛ", description: "Get a cute cat picture", id: `${config.PREFIX}cat` },
                    { title: "🐕 ᴅᴏɢ", description: "See a cute dog picture", id: `${config.PREFIX}dog` },
                    { title: "💡 ғᴀᴄᴛ", description: "Learn a random fact", id: `${config.PREFIX}fact` },
                    { title: "💘 ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ", description: "Get a cheesy pickup line", id: `${config.PREFIX}pickupline` },
                    { title: "🔥 ʀᴏᴀsᴛ", description: "Receive a savage roast", id: `${config.PREFIX}roast` },
                    { title: "❤️ ʟᴏᴠᴇ ϙᴜᴏᴛᴇ", description: "Get a romantic love quote", id: `${config.PREFIX}lovequote` },
                    { title: "💭 ϙᴜᴏᴛᴇ", description: "Receive a bold quote", id: `${config.PREFIX}quote` },
                    { title: "🎨 ᴇᴍᴏᴊɪ ᴍɪx", description: "Mix two emojis into one", id: `${config.PREFIX}emojimix` }
                  ]
                },
                {
                  title: "🔧 ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛɪᴇs",
                  rows: [
                    { title: "🤖 ᴀɪ", description: "Chat with AI assistant", id: `${config.PREFIX}ai` },
                    { title: "🚫ʙʟᴏᴄᴋ", description: "block user", id: `${config.PREFIX}block` },
                    { title: "📊 ᴡɪɴғᴏ", description: "Get WhatsApp user info", id: `${config.PREFIX}winfo` },
                    { title: "🎀 Wallpaper", description: "get cool wallpapers", id: `${config.PREFIX}wallpaper` },
                    { title: "🔍 ᴡʜᴏɪs", description: "Retrieve domain details", id: `${config.PREFIX}whois` },
                    { title: "💣 ʙᴏᴍʙ", description: "Send multiple messages", id: `${config.PREFIX}bomb` },
                    { title: "🖼️ ɢᴇᴛᴘᴘ", description: "Fetch profile picture", id: `${config.PREFIX}getpp` },
                    { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "Download someone's status", id: `${config.PREFIX}savestatus` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "Get weather forecast", id: `${config.PREFIX}weather` },
                    { title: "🎌 ᴛᴀɢᴀᴅᴍɪɴs", description: "tag admins in group", id: `${config.PREFIX}tagadmins` },
                    { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "Create shortened URL", id: `${config.PREFIX}shorturl` },
                    { title: "📦 ᴀᴘᴋ", description: "Download APK files", id: `${config.PREFIX}apk` },   
                    { title: "🧾lyrics", description: "generate lyrics", id: `${config.PREFIX}lyrics` },    
                    { title: "🤗github", description: "get people's github details", id: `${config.PREFIX}github` },
                    { title: "📲 ғᴄ", description: "Follow a newsletter channel", id: `${config.PREFIX}fc` },
                    { title: "📖 ᴀᴜᴛᴏʀᴇᴀᴅ", description: "Auto-read private messages", id: `${config.PREFIX}autoread` },
                    { title: "📢 ᴘᴏsᴛsᴛᴀᴛᴜs", description: "Post a text status", id: `${config.PREFIX}poststatus` },
                    { title: "👁️ ʙʟᴜᴇᴛɪᴄᴋ", description: "Toggle read receipts", id: `${config.PREFIX}bluetick` },
                    { title: "🔰 ᴀɴᴛɪᴅᴇʟᴇᴛᴇ", description: "Anti delete messages", id: `${config.PREFIX}antidelete` },
                    { title: "🛡️ ᴀɴᴛɪᴄᴀʟʟ", description: "Block & reject calls", id: `${config.PREFIX}anticall` },
                    { title: "⚡ ᴇᴠᴀʟ", description: "Execute JavaScript code", id: `${config.PREFIX}eval` }
                  ]
                }
              ]
            })
          }
        }
      ],
      headerType: 1,
      contextInfo: messageContext
    };
    
    // Send menu
    await socket.sendMessage(from, menuMessage, { quoted: fakevCard });
    
    // Send audio
    try {
        const audioResponse = await axios({
            method: 'get',
            url: 'https://files.catbox.moe/8rj7xf.mp3',
            responseType: 'arraybuffer'
        });
        await socket.sendMessage(from, {
            audio: Buffer.from(audioResponse.data),
            mimetype: 'audio/mpeg',
            ptt: true
        }, { quoted: fakevCard });
    } catch (audioError) {
        console.error('Menu audio error:', audioError.message);
    }
    
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    
  } catch (error) {
    console.error('Menu command error:', error);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    
    let fallbackMenuText = `
*╭────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs 〙───⊷*
*┃*  🤖 *Bot*: ᴄᴀsᴇʏʀʜᴅᴇs ᴍɪɴɪ 
*┃*  📍 *Prefix*: ${config.PREFIX}
*┃*  ⏰ *Uptime*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *Memory*: ${usedMemory}MB/${totalMemory}MB
*╰──────────────⊷*

${config.PREFIX}allmenu ᴛᴏ ᴠɪᴇᴡ ᴀʟʟ ᴄᴍᴅs 
> *mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

    await socket.sendMessage(from, {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: fallbackMenuText
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
// Case: tempmail / tmpmail / fakemail / disposable - Temporary disposable email
case 'tempmail':
case 'tmpmail':
case 'fakemail':
case 'disposable': {
    try {
        const { TempMail } = require('tempmail.lol');
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'inbox') {
            const address = args[1]?.trim();
            if (!address || !address.includes('@')) {
                await socket.sendMessage(sender, {
                    text: `❌ ᴘʀᴏᴠɪᴅᴇ ᴛʜᴇ ғᴜʟʟ ᴇᴍᴀɪʟ ᴀᴅᴅʀᴇss.\n\n*ᴜsᴀɢᴇ:* \`${prefix}tempmail inbox you@domain.com\``,
                    quoted: msg
                });
                break;
            }

            await socket.sendMessage(sender, { react: { text: '📬', key: msg.key } });

            const mail = new TempMail();
            const inbox = await mail.getInbox(address);
            if (!inbox?.length) {
                await socket.sendMessage(sender, {
                    text: `📭 *ɪɴʙᴏx ғᴏʀ* \`${address}\`\n\nɴᴏ ᴍᴇssᴀɢᴇs ʏᴇᴛ.\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }

            const items = inbox.slice(0, 5).map((m, i) =>
                `*${i + 1}.* ғʀᴏᴍ: ${m.sender}\n   sᴜʙᴊᴇᴄᴛ: ${m.subject || '(ɴᴏ sᴜʙᴊᴇᴄᴛ)'}`
            ).join('\n\n');

            await socket.sendMessage(sender, {
                text: `📬 *ɪɴʙᴏx ғᴏʀ* \`${address}\` (${inbox.length} ᴍsɢ)\n\n${items}\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });

        } else {
            // Create new temp email
            await socket.sendMessage(sender, { react: { text: '📧', key: msg.key } });

            const mail = new TempMail();
            const account = await mail.createAddress();
            const address = account.address || account.email || JSON.stringify(account);

            await socket.sendMessage(sender, {
                text: `📧 *ᴛᴇᴍᴘᴏʀᴀʀʏ ᴇᴍᴀɪʟ*\n\n` +
                      `\`${address}\`\n\n` +
                      `• ᴛᴀᴘ ᴛᴏ ᴄᴏᴘʏ\n` +
                      `• ᴄʜᴇᴄᴋ ɪɴʙᴏx: \`${prefix}tempmail inbox ${address}\`\n\n` +
                      `⚠️ ᴛʜɪs ᴀᴅᴅʀᴇss ɪs ᴛᴇᴍᴘᴏʀᴀʀʏ\n\n` +
                      `> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}tempmail inbox ${address}`, buttonText: { displayText: '📬 ᴄʜᴇᴄᴋ ɪɴʙᴏx' }, type: 1 },
                    { buttonId: `${prefix}tempmail`, buttonText: { displayText: '📧 ɴᴇᴡ ᴇᴍᴀɪʟ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[TempMail]', e.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴛᴇᴍᴘ ᴇᴍᴀɪʟ ғᴀɪʟᴇᴅ*\n\n${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: fact / facts / funfact - Get a random interesting fact
case 'fact':
case 'facts':
case 'funfact': {
    try {
        await socket.sendMessage(sender, { react: { text: '💡', key: msg.key } });

        let fact;
        
        try {
            const res = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random', {
                params: { language: 'en' },
                timeout: 8000
            });
            fact = res.data?.text;
            if (!fact) throw new Error('empty');
        } catch {
            // Fallback facts if API fails
            const fallbacks = [
                "ʜᴏɴᴇʏ ɴᴇᴠᴇʀ sᴘᴏɪʟs — ᴇᴅɪʙʟᴇ ʜᴏɴᴇʏ ʜᴀs ʙᴇᴇɴ ғᴏᴜɴᴅ ɪɴ 3,000-ʏᴇᴀʀ-ᴏʟᴅ ᴇɢʏᴘᴛɪᴀɴ ᴛᴏᴍʙs.",
                "ᴀ ɢʀᴏᴜᴘ ᴏғ ғʟᴀᴍɪɴɢᴏs ɪs ᴄᴀʟʟᴇᴅ ᴀ 'ғʟᴀᴍʙᴏʏᴀɴᴄᴇ'.",
                "ʙᴀɴᴀɴᴀs ᴀʀᴇ ᴄᴜʀᴠᴇᴅ ʙᴇᴄᴀᴜsᴇ ᴛʜᴇʏ ɢʀᴏᴡ ᴛᴏᴡᴀʀᴅs ᴛʜᴇ sᴜɴ.",
                "ᴛʜᴇ ᴇɪғғᴇʟ ᴛᴏᴡᴇʀ ᴄᴀɴ ʙᴇ 15 ᴄᴍ ᴛᴀʟʟᴇʀ ɪɴ sᴜᴍᴍᴇʀ ᴅᴜᴇ ᴛᴏ ᴍᴇᴛᴀʟ ᴇxᴘᴀɴsɪᴏɴ.",
                "ᴏᴄᴛᴏᴘᴜsᴇs ʜᴀᴠᴇ ᴛʜʀᴇᴇ ʜᴇᴀʀᴛs ᴀɴᴅ ʙʟᴜᴇ ʙʟᴏᴏᴅ.",
                "sʜᴀʀᴋs ᴀʀᴇ ᴏʟᴅᴇʀ ᴛʜᴀɴ ᴛʀᴇᴇs — ᴛʜᴇʏ'ᴠᴇ ᴇxɪsᴛᴇᴅ ғᴏʀ ᴏᴠᴇʀ 400 ᴍɪʟʟɪᴏɴ ʏᴇᴀʀs.",
                "ᴀ ᴅᴀʏ ᴏɴ ᴠᴇɴᴜs ɪs ʟᴏɴɢᴇʀ ᴛʜᴀɴ ᴀ ʏᴇᴀʀ ᴏɴ ᴠᴇɴᴜs.",
                "ᴡᴏᴍʙᴀᴛ ᴘᴏᴏᴘ ɪs ᴄᴜʙᴇ-sʜᴀᴘᴇᴅ."
            ];
            fact = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        await socket.sendMessage(sender, {
            text: `💡 *ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ*\n\n${fact}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}fact`, buttonText: { displayText: '💡 ᴀɴᴏᴛʜᴇʀ ғᴀᴄᴛ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Fact] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀᴄᴛ ғᴇᴛᴄʜ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: profile / myprofile / whatsapp - View WhatsApp profile info
case 'profile':
case 'myprofile':
case 'whatsapp': {
    try {
        const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const target = mentions[0] || nowsender;
        const num = target.split('@')[0];

        await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });

        let statusText = 'No status';
        let ppUrl = null;

        // Fetch status
        try {
            const status = await socket.fetchStatus(target);
            statusText = status?.status || 'No status';
        } catch {}

        // Fetch profile picture
        try {
            ppUrl = await socket.profilePictureUrl(target, 'image');
        } catch {}

        const profileText =
            `👤 *ᴡʜᴀᴛsᴀᴘᴘ ᴘʀᴏғɪʟᴇ*\n\n` +
            `📞 *ɴᴜᴍʙᴇʀ:* +${num}\n` +
            `💬 *sᴛᴀᴛᴜs:* ${statusText}\n` +
            `🌐 *ᴊɪᴅ:* ${target}\n\n` +
            `> ${config.BOT_FOOTER}`;

        if (ppUrl) {
            await socket.sendMessage(sender, {
                image: { url: ppUrl },
                caption: profileText,
                buttons: [
                    { buttonId: `${prefix}profile`, buttonText: { displayText: '👤 ᴠɪᴇᴡ ᴀɢᴀɪɴ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: profileText,
                buttons: [
                    { buttonId: `${prefix}profile`, buttonText: { displayText: '👤 ᴠɪᴇᴡ ᴀɢᴀɪɴ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Profile] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴘʀᴏғɪʟᴇ ғᴇᴛᴄʜ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//logo menu 
// Case: save / nitumie / statussave - Save a WhatsApp status
case 'save':
case 'nitumie':
case 'statussave': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (!quoted) {
            await socket.sendMessage(sender, {
                text: `📌 *sᴀᴠᴇ sᴛᴀᴛᴜs*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀ sᴛᴀᴛᴜs ɪᴍᴀɢᴇ ᴏʀ ᴠɪᴅᴇᴏ ᴡɪᴛʜ \`${prefix}save\` ᴛᴏ sᴀᴠᴇ ɪᴛ.\n\n*ᴜsᴀɢᴇ:* ʀᴇᴘʟʏ ᴛᴏ sᴛᴀᴛᴜs + \`${prefix}save\``,
                quoted: msg
            });
            break;
        }

        const isImage = !!quoted.imageMessage;
        const isVideo = !!quoted.videoMessage;

        if (!isImage && !isVideo) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴍᴇᴅɪᴀ*\n\nᴏɴʟʏ *ɪᴍᴀɢᴇ* ᴀɴᴅ *ᴠɪᴅᴇᴏ* sᴛᴀᴛᴜsᴇs ᴄᴀɴ ʙᴇ sᴀᴠᴇᴅ.`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });

        const mediaType = isImage ? 'image' : 'video';
        const msgContent = isImage ? quoted.imageMessage : quoted.videoMessage;

        // Download media
        const stream = await downloadContentFromMessage(msgContent, mediaType);
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        const caption = msgContent.caption || `📥 *sᴛᴀᴛᴜs sᴀᴠᴇᴅ ʙʏ ${config.OWNER_NAME}*`;

        // Send the saved status back
        await socket.sendMessage(sender, {
            [mediaType]: buffer,
            caption: `${caption}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}save`, buttonText: { displayText: '💾 sᴀᴠᴇ ᴍᴏʀᴇ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1,
            contextInfo: {
                externalAdReply: {
                    title: 'sᴛᴀᴛᴜs sᴀᴠᴇᴅ ✅',
                    body: `${config.OWNER_NAME} · sᴛᴀᴛᴜs ᴅᴏᴡɴʟᴏᴀᴅᴇʀ`,
                    thumbnailUrl: config.RCD_IMAGE_PATH,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[StatusSave] Error:', err.message);
        
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ sᴀᴠᴇ sᴛᴀᴛᴜs*\n\n${err.message}`,
            buttons: [
                { buttonId: `${prefix}save`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
case 'logo': 
case 'logomenu': {
    try {
        await socket.sendMessage(sender, { 
            react: { 
                text: "🎨", 
                key: msg.key 
            } 
        });

        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        
        let menuText = `*╭─────────────────⊷*  
*┃* *🎨ʙᴏᴛ* ɴᴀᴍᴇ: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ
*╰──────────────────⊷*
`;

        const messageContext = {
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420261263259@newsletter',
                newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                serverMessageId: -1
            }
        };

        const logoMessage = {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: `*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐋𝐎𝐆𝐎 𝐌𝐀𝐊𝐄𝐑 🎀*\n${menuText}`,
            buttons: [
                {
                    buttonId: `${prefix}quick_logos`,
                    buttonText: { displayText: '🎨 LOGO MENU' },
                    type: 4,
                    nativeFlowInfo: {
                        name: 'single_select',
                        paramsJson: JSON.stringify({
                            title: '🎨 CASEYRHODES LOGO MAKER',
                            sections: [
                                {
                                    title: "🎌 ᴀɴɪᴍᴇ & ɢᴀᴍᴇ ʟᴏɢᴏs",
                                    highlight_label: 'Popular',
                                    rows: [
                                        { title: "🐉 ᴅʀᴀɢᴏɴʙᴀʟʟ", description: "Dragon Ball style text effect", id: `${prefix}dragonball` },
                                        { title: "🌀 ɴᴀʀᴜᴛᴏ", description: "Naruto Shippuden logo style", id: `${prefix}naruto` },
                                        { title: "⚔️ ᴀʀᴇɴᴀ", description: "Arena of Valor cover style", id: `${prefix}arena` }
                                    ]
                                },
                                {
                                    title: "💻 ᴍᴏᴅᴇʀɴ & ᴛᴇᴄʜ ʟᴏɢᴏs",
                                    highlight_label: 'Trending',
                                    rows: [
                                        { title: "💻 ʜᴀᴄᴋᴇʀ", description: "Anonymous hacker neon avatar", id: `${prefix}hacker` },
                                        { title: "⚙️ ᴍᴇᴄʜᴀɴɪᴄᴀʟ", description: "Mechanical style text effect", id: `${prefix}mechanical` },
                                        { title: "💡 ɪɴᴄᴀɴᴅᴇsᴄᴇɴᴛ", description: "Light bulb text effects", id: `${prefix}incandescent` },
                                        { title: "🏆 ɢᴏʟᴅ", description: "Modern gold text effect", id: `${prefix}gold` }
                                    ]
                                },
                                {
                                    title: "🌈 ɴᴀᴛᴜʀᴇ & ᴇғғᴇᴄᴛ ʟᴏɢᴏs",
                                    highlight_label: 'Beautiful',
                                    rows: [
                                        { title: "🏖️ sᴀɴᴅ", description: "Write text on sand online", id: `${prefix}sand` },
                                        { title: "🌅 sᴜɴsᴇᴛ", description: "Sunset light text effects", id: `${prefix}sunset` },
                                        { title: "💧 ᴡᴀᴛᴇʀ", description: "Water effect text online", id: `${prefix}water` },
                                        { title: "🌧️ ʀᴀɪɴ", description: "Foggy rainy text effect", id: `${prefix}rain` }
                                    ]
                                },
                                {
                                    title: "🎨 ᴀʀᴛ & ᴄʀᴇᴀᴛɪᴠᴇ ʟᴏɢᴏs",
                                    highlight_label: 'Creative',
                                    rows: [
                                        { title: "🍫 ᴄʜᴏᴄᴏʟᴀᴛᴇ", description: "Chocolate text effect", id: `${prefix}chocolate` },
                                        { title: "🎨 ɢʀᴀғғɪᴛɪ", description: "Cartoon style graffiti text", id: `${prefix}graffiti` },
                                        { title: "💥 ʙᴏᴏᴍ", description: "Comic boom text effect", id: `${prefix}boom` },
                                        { title: "🟣 ᴘᴜʀᴘʟᴇ", description: "Purple text effect online", id: `${prefix}purple` }
                                    ]
                                },
                                {
                                    title: "📝 ᴛᴇxᴛ & ᴛʏᴘᴏɢʀᴀᴘʜʏ",
                                    highlight_label: 'Text Styles',
                                    rows: [
                                        { title: "👕 ᴄʟᴏᴛʜ", description: "Text on cloth effect", id: `${prefix}cloth` },
                                        { title: "🎬 1917", description: "1917 movie style text", id: `${prefix}1917` },
                                        { title: "👶 ᴄʜɪʟᴅ", description: "Write text on wet glass", id: `${prefix}child` },
                                        { title: "🐱 ᴄᴀᴛ", description: "Handwritten foggy glass", id: `${prefix}cat` },
                                        { title: "📝 ᴛʏᴘᴏ", description: "Typography on pavement", id: `${prefix}typo` }
                                    ]
                                }
                            ]
                        })
                    }
                }
            ],
            headerType: 1,
            contextInfo: messageContext
        };

        // Send logo menu
        await socket.sendMessage(sender, logoMessage, { quoted: fakevCard });
        await socket.sendMessage(sender, { 
            react: { 
                text: '✅', 
                key: msg.key 
            } 
        });

    } catch (error) {
        console.error('Logo menu command error:', error);
        
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        let fallbackText = `
*╭────〘 ᴄᴀsᴇʏʀʜᴏᴅᴇs ʟᴏɢᴏ ᴍᴀᴋᴇʀ 〙───⊷*
*┃*  🎨 *Bot*: ᴄᴀsᴇʏʀʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *Prefix*: ${prefix}
*┃*  💾 *Memory*: ${usedMemory}MB
*╰────────────────⊷
> *mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

        await socket.sendMessage(sender, {
            image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
            caption: fallbackText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });
        await socket.sendMessage(sender, { 
            react: { 
                text: '❌', 
                key: msg.key 
            } 
        });
    }
    break;
}
case 'allmenu': {
  try {
    await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
    

    let allMenuText = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 🎀*
*╭───────────────⊷*
*┃*  🤖 *ʙᴏᴛ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ 
*┃*  📍 *ᴘʀᴇғɪx*: ${config.PREFIX}
*┃*  ⏰ *ᴜᴘᴛɪᴍᴇ*: ${hours}h ${minutes}m ${seconds}s
*┃*  💾 *ᴍᴇᴍᴏʀʏ*: ${usedMemory}MB/${totalMemory}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃*  🇰🇪 *ᴏᴡɴᴇʀ*: ${config.OWNER_NAME}
*╰────────────────⊷*

 ╭─『 🌐 *ɢᴇɴᴇʀᴀʟ* 』─╮
*┃*  🟢 ${prefix}alive
*┃*  🏓 ${prefix}ping
*┃*  📋 ${prefix}menu
*┃*  📜 ${prefix}allmenu
*┃*  📊 ${prefix}ginfo
*┃*  👥 ${prefix}members
*┃*  🛡️ ${prefix}admins
*┃*  🌟 ${prefix}profile
*┃*  📸 ${prefix}igstalk
*┃*  🔮 ${prefix}repo
*┃*  🔮 ${prefix}github
*┃*  🎀 ${prefix}gitclone
*┃*  👑 ${prefix}owner
*┃*  🔗 ${prefix}pair
*┃*  🌍 ${prefix}country
*┃*  🕐 ${prefix}time
*┃*  🌍 ${prefix}translate
*┃*  🔮 ${prefix}horo
*┃*  🎨 ${prefix}emojimix
*┃*  🎨 ${prefix}ascii
*┃*  🧮 ${prefix}calc
*┃*  💡 ${prefix}fact
*┃*  💐 ${prefix}comp
*┃*  📜 ${prefix}quran
*┃*  💠 ${prefix}bible
*┃*  ✨ ${prefix}fancy
*┃*  🔮 ${prefix}ss
*┃*  📱 ${prefix}qr
*┃*  🎨 ${prefix}logo
*┃*  🖼️ ${prefix}wallpaper
*┃*  📰 ${prefix}news
*┃*  🚀 ${prefix}nasa
*┃*  📧 ${prefix}tempmail
*╰──────────────⊷*

 ╭─『 🎵 *ᴅᴏᴡɴʟᴏᴀᴅs* 』─╮
*┃*  🎵 ${prefix}song
*┃*  🎵 ${prefix}ytmp3
*┃*  🎊 ${prefix}play
*┃*  📱 ${prefix}tiktok
*┃*  📱 ${prefix}tt
*┃*  📘 ${prefix}fb
*┃*  📘 ${prefix}fbdl
*┃*  📸 ${prefix}ig
*┃*  🎵 ${prefix}shazam
*┃*  🎵 ${prefix}lyrics
*┃*  📤 ${prefix}tourl
*┃*  📁 ${prefix}mf
*┃*  📁 ${prefix}mediafire
*┃*  📦 ${prefix}apk
*┃*  🖼️ ${prefix}aiimg
*┃*  👀 ${prefix}viewonce
*┃*  🖼️ ${prefix}sticker
*┃*  🗣️ ${prefix}tts
*┃*  📦 ${prefix}gitclone
*╰──────────────⊷*

 ╭─『 🫂 *ɢʀᴏᴜᴘ* 』─╮
*┃*  ➕ ${prefix}add
*┃*  🦶 ${prefix}kick
*┃*  🔓 ${prefix}open
*┃*  🔓 ${prefix}unmute
*┃*  🔒 ${prefix}close
*┃*  🔒 ${prefix}mute
*┃*  👑 ${prefix}promote
*┃*  😢 ${prefix}demote
*┃*  🔗 ${prefix}link
*┃*  🔗 ${prefix}grouplink
*┃*  🔄 ${prefix}revoke
*┃*  📝 ${prefix}setname
*┃*  📝 ${prefix}groupname
*┃*  📝 ${prefix}setdesc
*┃*  📝 ${prefix}gcdesc
*┃*  👥 ${prefix}tagall
*┃*  👻 ${prefix}hidetag
*┃*  🎌 ${prefix}tagadmins
*┃*  👤 ${prefix}join
*┃*  💠 ${prefix}leave
*┃*  💠 ${prefix}left
*┃*  📊 ${prefix}poll
*┃*  📢 ${prefix}togstatus
*┃*  👋 ${prefix}welcome
*┃*  👋 ${prefix}goodbye
*┃*  👋 ${prefix}setwelcome
*┃*  👋 ${prefix}setgoodbye
*┃*  📇 ${prefix}vcfgen
*┃*  📇 ${prefix}vcfgroup
*┃*  📇 ${prefix}vcfnumber
*┃*  📇 ${prefix}vcfread
*┃*  📋 ${prefix}auditlog
*┃*  📋 ${prefix}listrequests
*┃*  ✅ ${prefix}accept
*┃*  ✅ ${prefix}acceptall
*┃*  ❌ ${prefix}reject
*┃*  ❌ ${prefix}rejectall
*┃*  ⏳ ${prefix}disapp
*┃*  🗑️ ${prefix}del
*┃*  ⚙️ ${prefix}groupsettings
*┃*  📢 ${prefix}everyone
*┃*  🖼️ ${prefix}gcpp
*╰──────────────⊷*

 ╭─『 ⚽ *sᴘᴏʀᴛs* 』─╮
*┃*  ⚽ ${prefix}livescore
*┃*  🏆 ${prefix}sportnews
*┃*  🏆 ${prefix}standings
*┃*  ⚽ ${prefix}topscorers
*┃*  📅 ${prefix}upcomingmatches
*┃*  📋 ${prefix}gamehistory
*╰──────────────⊷*

 ╭─『 😂 *ғᴜɴ* 』─╮
*┃*  😂 ${prefix}joke
*┃*  🌚 ${prefix}darkjoke
*┃*  😂 ${prefix}meme
*┃*  💫 ${prefix}waifu
*┃*  🐈 ${prefix}cat
*┃*  🐕 ${prefix}dog
*┃*  💡 ${prefix}fact
*┃*  💘 ${prefix}pickupline
*┃*  🔥 ${prefix}roast
*┃*  ❤️ ${prefix}lovequote
*┃*  💭 ${prefix}quote
*┃*  💐 ${prefix}comp
*┃*  🎨 ${prefix}emojimix
*┃*  🎨 ${prefix}ascii
*╰──────────────⊷*

 ╭─『 ⚙️ *ᴏᴡɴᴇʀ* 』─╮
*┃*  ⚙️ ${prefix}settings
*┃*  🔰 ${prefix}antidelete
*┃*  🔰 ${prefix}ad
*┃*  🔰 ${prefix}antidel
*┃*  🛡️ ${prefix}anticall
*┃*  📖 ${prefix}autoread
*┃*  👁️ ${prefix}bluetick
*┃*  🪀 ${prefix}mode
*┃*  ⚡ ${prefix}eval
*┃*  📢 ${prefix}poststatus
*┃*  📢 ${prefix}broadcast
*┃*  📢 ${prefix}bc
*┃*  👁️ ${prefix}presence
*┃*  👁️ ${prefix}typing
*┃*  🔰 ${prefix}setpp
*┃*  💀 ${prefix}killgc
*╰──────────────⊷*

 ╭─『 🔧 *ᴛᴏᴏʟs* 』─╮
*┃*  🤖 ${prefix}ai
*┃*  📊 ${prefix}winfo
*┃*  🔍 ${prefix}whois
*┃*  🌦️ ${prefix}weather
*┃*  🔗 ${prefix}shorturl
*┃*  💾 ${prefix}savestatus
*┃*  💾 ${prefix}save
*┃*  🖼️ ${prefix}getpp
*┃*  🚫 ${prefix}block
*┃*  🚩 ${prefix}blocklist
*┃*  🔮 ${prefix}github
*┃*  📲 ${prefix}fc
*┃*  📜 ${prefix}pdf
*┃*  📱 ${prefix}send
*┃*  📇 ${prefix}vcf
*╰──────────────⊷*

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ* ッ
`;

    const buttons = [
      {buttonId: `${prefix}alive`, buttonText: {displayText: '🟢 ᴀʟɪᴠᴇ'}, type: 1},
      {buttonId: `${prefix}menu`, buttonText: {displayText: '📋 ᴍᴇɴᴜ'}, type: 1},
      {buttonId: `${prefix}settings`, buttonText: {displayText: '⚙️ sᴇᴛᴛɪɴɢs'}, type: 1}
    ];

    const buttonMessage = {
      image: { url: "https://i.ibb.co/fGSVG8vJ/caseyweb.jpg" },
      caption: allMenuText,
      footer: "Click buttons for quick actions",
      buttons: buttons,
      headerType: 4
    };

    await socket.sendMessage(from, buttonMessage, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Allmenu command error:', error);
    await socket.sendMessage(from, {
      text: `❌ *Oh, darling, the menu got shy! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//autobio test 
//autobio test 
case 'autobio':
case 'bio': {
    try {
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
        const args = q.split(' ').slice(1);
        const action = args[0]?.toLowerCase();
        
        if (action === 'on' || action === 'start') {
            // Start auto-bio
            if (global.bioInterval) {
                clearInterval(global.bioInterval);
            }
            
            const updateBio = () => {
                const date = new Date();
                const bioText = `🎀ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ🎀🌸 |📅 DATE/TIME: ${date.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })} | DAY: ${date.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Nairobi'})}`;
                
                socket.updateProfileStatus(bioText)
                    .then(() => console.log('✅ Bio updated successfully'))
                    .catch(err => console.error('❌ Error updating bio:', err));
            }

            updateBio(); // Update immediately
            global.bioInterval = setInterval(updateBio, 10 * 1000);
            
            // Success message with button
            const successMessage = {
                text: '✅ *Auto-Bio Started!*',
                footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                buttons: [
                    {
                        buttonId: `${prefix}autobio off`,
                        buttonText: { displayText: '❌ STOP AUTO-BIO' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, successMessage, { quoted: msg });
            
        } else if (action === 'off' || action === 'stop') {
            // Stop auto-bio
            if (global.bioInterval) {
                clearInterval(global.bioInterval);
                global.bioInterval = null;
                
                // Success message with button
                const successMessage = {
                    text: '✅ *Auto-Bio Stopped!*',
                    footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                    buttons: [
                        {
                            buttonId: `${prefix}autobio on`,
                            buttonText: { displayText: '✅ START AUTO-BIO' },
                            type: 1
                        }
                    ],
                    headerType: 1
                };
                
                await socket.sendMessage(sender, successMessage, { quoted: msg });
            } else {
                await socket.sendMessage(sender, {
                    text: 'ℹ️ *Auto-Bio is not currently running.*'
                }, { quoted: msg });
            }
            
        } else {
            // Show status with interactive buttons
            const status = global.bioInterval ? '🟢 ON' : '🔴 OFF';
            
            const buttonMessage = {
                text: `📝 *Auto-Bio Status:* ${status}\n\nUsage:\n• ${prefix}autobio on - Start auto-bio\n• ${prefix}autobio off - Stop auto-bio\n\nOr use the buttons below:`,
                footer: 'Interactive Auto-Bio Control',
                buttons: [
                    {
                        buttonId: `${prefix}autobio on`,
                        buttonText: { displayText: '✅ TURN ON' },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}autobio off`, 
                        buttonText: { displayText: '❌ TURN OFF' },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, buttonMessage, { quoted: msg });
        }
        
    } catch (error) {
        console.error('Auto-Bio command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Error controlling auto-bio*'
        }, { quoted: msg });
    }
    break;
}

 case 'creact': {
    const q = args.join(" ");

    if (!q.includes(",")) {
        return await socket.sendMessage(sender, {
            text: '😒 Please provide the link and emoji separated by a comma.\n\nExample:\n.cnr https://whatsapp.com/channel/120363396379901844/ABCDEF1234,🔥'
        });
    }

    try {
        let [link, emoji] = q.split(",");
        const parts = link.trim().split("/");
        const channelJid = `${parts[4]}@newsletter`;
        const msgId = parts[5];

        await socket.sendMessage(channelJid, {
            react: {
                text: emoji.trim(),
                key: {
                    remoteJid: channelJid,
                    id: msgId,
                    fromMe: false
                },
            },
        });

        await socket.sendMessage(sender, {
            text: `✅ Reacted to the channel message with ${emoji.trim()}`
        });
    } catch (e) {
        console.error("❌ Error in .cnr:", e);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${e.message}`
        });
    }
                     break;
            }
		
// Case: fc (follow channel)
case 'follow': {
  if (args.length === 0) {
    return await socket.sendMessage(sender, {
      text: '❗ Please provide a channel JID.\n\nExample:\n.fcn 120363299029326322@newsletter'
    });
  }

  const jid = args[0];
  if (!jid.endsWith("@newsletter")) {
    return await socket.sendMessage(sender, {
      text: '❗ Invalid JID. Please provide a JID ending with `@newsletter`'
    });
  }

  try {
    await socket.sendMessage(sender, { react: { text: '😌', key: msg.key } });
    const metadata = await socket.newsletterMetadata("jid", jid);
    if (metadata?.viewer_metadata === null) {
      await socket.newsletterFollow(jid);
      await socket.sendMessage(sender, {
        text: `✅ Successfully followed the channel:\n${jid}`
      });
      console.log(`FOLLOWED CHANNEL: ${jid}`);
    } else {
      await socket.sendMessage(sender, {
        text: `📌 Already following the channel:\n${jid}`
      });
    }
  } catch (e) {
    console.error('❌ Error in follow channel:', e.message);
    await socket.sendMessage(sender, {
      text: `❌ Error: ${e.message}`
    });
  }
  break;
}
// Case: poll / vote - Create a WhatsApp native poll
case 'poll':
case 'vote': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴄʀᴇᴀᴛᴇ ᴘᴏʟʟs.',
                quoted: msg
            });
            break;
        }

        const input = args.join(' ').trim();
        
        if (!input) {
            await socket.sendMessage(sender, {
                text: `📊 *ᴄʀᴇᴀᴛᴇ ᴘᴏʟʟ*\n\n*ᴜsᴀɢᴇ:*\n\`${prefix}poll Question | Option1 | Option2 | ...\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}poll Favourite color? | Red | Blue | Green\`\n\`${prefix}poll Best food? | Pizza | Burger | Sushi | Pasta\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}poll Best food? | Pizza | Burger | Sushi`, buttonText: { displayText: '🍕 ғᴏᴏᴅ ᴘᴏʟʟ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        const parts = input.split('|').map(s => s.trim()).filter(Boolean);
        
        if (parts.length < 3) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ғᴏʀᴍᴀᴛ*\n\nʏᴏᴜ ɴᴇᴇᴅ ᴀ ϙᴜᴇsᴛɪᴏɴ ᴀɴᴅ ᴀᴛ ʟᴇᴀsᴛ *2 ᴏᴘᴛɪᴏɴs*.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}poll Best fruit? | Apple | Mango | Banana\``,
                quoted: msg
            });
            break;
        }

        const [question, ...options] = parts;
        
        if (options.length > 12) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴛᴏᴏ ᴍᴀɴʏ ᴏᴘᴛɪᴏɴs*\n\nᴍᴀxɪᴍᴜᴍ *12 ᴏᴘᴛɪᴏɴs* ᴀʟʟᴏᴡᴇᴅ.',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📊', key: msg.key } });

        // Send the poll
        await socket.sendMessage(from, {
            poll: {
                name: question,
                values: options,
                selectableCount: 1
            }
        });

        await socket.sendMessage(sender, {
            text: `✅ *ᴘᴏʟʟ ᴄʀᴇᴀᴛᴇᴅ!*\n\n📊 *ϙᴜᴇsᴛɪᴏɴ:* ${question}\n📋 *ᴏᴘᴛɪᴏɴs:* ${options.length}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Poll] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴘᴏʟʟ ᴄʀᴇᴀᴛɪᴏɴ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: ping
// Case: ping - Check bot response time and uptime
case 'ping': {
    try {
        await socket.sendMessage(sender, { react: { text: '🏓', key: msg.key } });

        const start = performance.now();
        
        // Send initial ping message
        const pingMsg = await socket.sendMessage(sender, {
            text: '🏓 *ᴘɪɴɢɪɴɢ...*',
            quoted: msg
        });
        
        const responseTime = (performance.now() - start).toFixed(2);

        // Calculate uptime
        const startTime = socketCreationTime.get(number) || Date.now();
        const uptime = Math.floor((Date.now() - startTime) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = Math.floor(uptime % 60);

        // System info
        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
        const platform = os.platform();
        const nodeVersion = process.version;

        // Delete ping message
        try { await socket.sendMessage(sender, { delete: pingMsg.key }); } catch {}

        const pingText = 
            `🏓 *ᴘᴏɴɢ!*\n\n` +
            `⏱ *ʀᴇsᴘᴏɴsᴇ:* ${responseTime} ᴍs\n` +
            `⏳ *ᴜᴘᴛɪᴍᴇ:* ${hours}ʜ ${minutes}ᴍ ${seconds}s\n` +
            `💾 *ʀᴀᴍ:* ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ\n` +
            `🖥 *ᴘʟᴀᴛғᴏʀᴍ:* ${platform}\n` +
            `📦 *ɴᴏᴅᴇ:* ${nodeVersion}\n\n` +
            `> ${config.BOT_FOOTER}`;

        await socket.sendMessage(sender, {
            text: pingText,
            buttons: [
                { buttonId: `${prefix}ping`, buttonText: { displayText: '🔄 ʀᴇғʀᴇsʜ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Ping] Error:', error.message);
        
        // Fallback simple ping
        const start = performance.now();
        await socket.sendMessage(sender, {
            text: `🏓 *ᴘᴏɴɢ!*\n\n⏱ *ʀᴇsᴘᴏɴsᴇ:* ${(performance.now() - start).toFixed(2)} ᴍs\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}ping`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: ascii / figlet / art / textart - Convert text to ASCII art
case 'ascii':
case 'figlet':
case 'art':
case 'textart': {
    try {
        const figlet = require('figlet');
        const FONTS = ['Standard', 'Big', 'Slant', 'Banner', 'Block', 'Doom', 'Ghost', 'Poison', 'Thick'];

        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `🎨 *ᴀsᴄɪɪ ᴀʀᴛ*\n\nᴄᴏɴᴠᴇʀᴛ ᴛᴇxᴛ ᴛᴏ ᴀsᴄɪɪ ᴀʀᴛ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}ascii <text>\`\n\n*ғᴏɴᴛs:* ${FONTS.map(f => f).join(', ')}\n\n*ᴡɪᴛʜ ғᴏɴᴛ:* \`${prefix}ascii Hello --font Slant\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}ascii Hello --font Big`, buttonText: { displayText: '🎨 ʙɪɢ ғᴏɴᴛ' }, type: 1 },
                    { buttonId: `${prefix}ascii Hello --font Slant`, buttonText: { displayText: '🎨 sʟᴀɴᴛ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎨', key: msg.key } });

        let font = 'Standard';
        let text = args.join(' ');

        const fontIdx = text.indexOf('--font');
        if (fontIdx !== -1) {
            const parts = text.slice(fontIdx + 6).trim().split(/\s+/);
            const requestedFont = parts[0];
            if (FONTS.map(f => f.toLowerCase()).includes(requestedFont.toLowerCase())) {
                font = FONTS.find(f => f.toLowerCase() === requestedFont.toLowerCase());
            }
            text = text.slice(0, fontIdx).trim();
        }

        if (!text) {
            await socket.sendMessage(sender, {
                text: '❌ ᴘʀᴏᴠɪᴅᴇ ᴛᴇxᴛ ʙᴇғᴏʀᴇ ᴛʜᴇ --ғᴏɴᴛ ᴏᴘᴛɪᴏɴ.',
                quoted: msg
            });
            break;
        }

        if (text.length > 30) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴛᴇxᴛ ᴛᴏᴏ ʟᴏɴɢ*\n\nᴍᴀx 30 ᴄʜᴀʀᴀᴄᴛᴇʀs ғᴏʀ ᴀsᴄɪɪ ᴀʀᴛ.',
                quoted: msg
            });
            break;
        }

        figlet.text(text, { font }, async (err, result) => {
            if (err || !result) {
                await socket.sendMessage(sender, {
                    text: '❌ ғᴀɪʟᴇᴅ ᴛᴏ ɢᴇɴᴇʀᴀᴛᴇ ᴀsᴄɪɪ ᴀʀᴛ.',
                    quoted: msg
                });
                await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                return;
            }
            await socket.sendMessage(sender, {
                text: `\`\`\`\n${result}\n\`\`\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}ascii`, buttonText: { displayText: '🎨 ᴍᴀᴋᴇ ᴀɴᴏᴛʜᴇʀ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        });

    } catch (error) {
        console.error('[ASCII] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ᴀsᴄɪɪ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: igstalk / instastalk / iginfo / instagramstalk - Instagram profile stalker
case 'igstalk':
case 'instastalk':
case 'iginfo':
case 'instagramstalk': {
    try {
        let username = args[0]?.replace(/^@/, '').trim();
        
        if (!username) {
            await socket.sendMessage(sender, {
                text: `📸 *ɪɴsᴛᴀɢʀᴀᴍ sᴛᴀʟᴋᴇʀ*\n\nɢᴇᴛ ᴅᴇᴛᴀɪʟᴇᴅ ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ ɪɴғᴏ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}igstalk <username>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}igstalk cristiano\`\n• \`${prefix}igstalk leomessi\`\n• \`${prefix}igstalk therock\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}igstalk cristiano`, buttonText: { displayText: '👤 ᴄʀɪsᴛɪᴀɴᴏ' }, type: 1 },
                    { buttonId: `${prefix}igstalk leomessi`, buttonText: { displayText: '👤 ᴍᴇssɪ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📸', key: msg.key } });

        // Send fetching message
        const fetchingMsg = await socket.sendMessage(sender, {
            text: `⏳ *ғᴇᴛᴄʜɪɴɢ ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ...*\n\n@${username}`,
            quoted: msg
        });

        // Fetch Instagram profile
        const { data } = await axios.get(
            `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
            {
                timeout: 12000,
                headers: {
                    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 458229258)',
                    'Accept': 'application/json',
                    'x-ig-app-id': '936619743392459',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            }
        );

        const u = data?.data?.user;
        if (!u) throw new Error('No user data');

        // Delete fetching message
        try { await socket.sendMessage(sender, { delete: fetchingMsg.key }); } catch {}

        const followers = u.edge_followed_by?.count ?? 0;
        const following = u.edge_follow?.count ?? 0;
        const posts = u.edge_owner_to_timeline_media?.count ?? 0;

        function fmtNum(n) {
            if (n === undefined || n === null) return 'N/A';
            if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
            return String(n);
        }

        const profileText =
            `📸 *ɪɴsᴛᴀɢʀᴀᴍ ᴘʀᴏғɪʟᴇ*\n\n` +
            `*🆔 ɪᴅᴇɴᴛɪᴛʏ*\n` +
            `• *ᴜsᴇʀɴᴀᴍᴇ:* @${u.username}\n` +
            `${u.full_name ? `• *ɴᴀᴍᴇ:* ${u.full_name}\n` : ''}` +
            `${u.biography ? `\n*📝 ʙɪᴏ:*\n${u.biography.slice(0, 200)}\n` : ''}` +
            `\n*📊 sᴛᴀᴛs*\n` +
            `• *ғᴏʟʟᴏᴡᴇʀs:* ${fmtNum(followers)}\n` +
            `• *ғᴏʟʟᴏᴡɪɴɢ:* ${fmtNum(following)}\n` +
            `• *ᴘᴏsᴛs:* ${fmtNum(posts)}\n` +
            `\n*⚙️ ɪɴғᴏ*\n` +
            `• *ᴘʀɪᴠᴀᴛᴇ:* ${u.is_private ? '🔒 Yes' : '🔓 No'}\n` +
            `• *ᴠᴇʀɪғɪᴇᴅ:* ${u.is_verified ? '✅ Yes' : '❌ No'}\n` +
            `• *ʙᴜsɪɴᴇss:* ${u.is_business_account ? '🏢 Yes' : '👤 No'}\n` +
            `${u.external_url ? `• *ʟɪɴᴋ:* ${u.external_url}\n` : ''}` +
            `\n• *ᴘʀᴏғɪʟᴇ:* https://www.instagram.com/${u.username}/\n\n` +
            `> ${config.BOT_FOOTER}`;

        const picUrl = u.profile_pic_url_hd || u.profile_pic_url || null;

        if (picUrl) {
            await socket.sendMessage(sender, {
                image: { url: picUrl },
                caption: profileText,
                buttons: [
                    { buttonId: `https://www.instagram.com/${u.username}/`, buttonText: { displayText: '📸 ᴠɪᴇᴡ ᴘʀᴏғɪʟᴇ' }, type: 1 },
                    { buttonId: `${prefix}igstalk`, buttonText: { displayText: '🔍 sᴛᴀʟᴋ ᴀɢᴀɪɴ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: profileText,
                buttons: [
                    { buttonId: `https://www.instagram.com/${u.username}/`, buttonText: { displayText: '📸 ᴠɪᴇᴡ ᴘʀᴏғɪʟᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[IGStalk] Error:', error.message);

        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: `❌ *ᴜsᴇʀ ɴᴏᴛ ғᴏᴜɴᴅ*\n\nᴛʜᴇ ɪɴsᴛᴀɢʀᴀᴍ ᴜsᴇʀ *@${args[0]}* ᴅᴏᴇs ɴᴏᴛ ᴇxɪsᴛ.`,
                quoted: msg
            });
        } else if (error.response?.status === 429) {
            await socket.sendMessage(sender, {
                text: `⏳ *ʀᴀᴛᴇ ʟɪᴍɪᴛᴇᴅ*\n\nɪɴsᴛᴀɢʀᴀᴍ ɪs ʀᴀᴛᴇ-ʟɪᴍɪᴛɪɴɢ ᴛʜɪs ʀᴇϙᴜᴇsᴛ. ᴡᴀɪᴛ ᴀ ғᴇᴡ ᴍɪɴᴜᴛᴇs ᴀɴᴅ ᴛʀʏ ᴀɢᴀɪɴ.`,
                quoted: msg
            });
        } else {
            await socket.sendMessage(sender, {
                text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
                buttons: [
                    { buttonId: `${prefix}igstalk`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: pair
// Case: pair
case 'pair': {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: `*📌 ᴘᴀɪʀɪɴɢ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}pair 25410XXXXXX\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}pair 254712345678\`\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }

    await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

    try {
        const url = `https://mini-bot-1-9vf1.onrender.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            return await socket.sendMessage(sender, {
                text: '❌ ɪɴᴠᴀʟɪᴅ ʀᴇsᴘᴏɴsᴇ ғʀᴏᴍ sᴇʀᴠᴇʀ.',
                quoted: msg
            });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ ғᴀɪʟᴇᴅ ᴛᴏ ʀᴇᴛʀɪᴇᴠᴇ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ.',
                quoted: msg
            });
        }

        // METHOD 1: CTA Copy button (works on some Baileys versions)
        const copyButtonMessage = {
            text: `*📋 ᴛᴀᴘ ᴛʜᴇ ʙᴜᴛᴛᴏɴ ʙᴇʟᴏᴡ ᴛᴏ ᴄᴏᴘʏ ʏᴏᴜʀ ᴄᴏᴅᴇ*`,
            footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
            templateButtons: [
                {
                    index: 1,
                    copyCodeButton: {
                        displayText: '📋 ᴄᴏᴘʏ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ',
                        code: result.code
                    }
                },
                {
                    index: 2,
                    quickReplyButton: {
                        displayText: '👨‍💻 sᴜᴘᴘᴏʀᴛ',
                        id: `${prefix}owner`
                    }
                }
            ],
            headerType: 1
        };

        // Try sending with copy button
        try {
            await socket.sendMessage(sender, copyButtonMessage, { quoted: msg });
        } catch (copyError) {
            // Fallback: Send code as standalone message for easy copying
            console.log('Copy button not supported, using fallback');
            await socket.sendMessage(sender, {
                text: `*🔑 ʏᴏᴜʀ ᴘᴀɪʀɪɴɢ ᴄᴏᴅᴇ:*\n\n\`\`\`${result.code}\`\`\`\n\n_ᴛᴀᴘ & ʜᴏʟᴅ ᴛʜᴇ ᴄᴏᴅᴇ ᴀʙᴏᴠᴇ ᴛᴏ ᴄᴏᴘʏ ɪᴛ_`,
                buttons: [
                    { buttonId: `${prefix}owner`, buttonText: { displayText: '👨‍💻 sᴜᴘᴘᴏʀᴛ' }, type: 1 },
                    { buttonId: `${prefix}pair`, buttonText: { displayText: '🔄 ɴᴇᴡ ᴄᴏᴅᴇ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ ᴀɴ ᴇʀʀᴏʀ ᴏᴄᴄᴜʀʀᴇᴅ.',
            buttons: [
                { buttonId: `${prefix}owner`, buttonText: { displayText: '👨‍💻 sᴜᴘᴘᴏʀᴛ' }, type: 1 }
            ]
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    
    break;
}

//case tagadmin
case 'tagadmins':
case 'gc_tagadmins': {
    try {
        // Check if it's a group
        const isGroup = sender.endsWith('@g.us');
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ *This command only works in group chats.*'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Get group metadata
        const groupMetadata = await socket.groupMetadata(sender);
        const groupName = groupMetadata.subject || "Unnamed Group";
        
        // Get admins from participants
        const admins = groupMetadata.participants
            .filter(participant => participant.admin)
            .map(admin => admin.id);

        if (!admins || admins.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No admins found in this group.*'
            }, { quoted: msg });
        }

        // Extract message text from command
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || '';
        const args = q.split(' ').slice(1);
        const messageText = args.join(' ') || "Attention Admins ⚠️";

        // Admin emojis
        const emojis = ['👑', '⚡', '🌟', '✨', '🎖️', '💎', '🔱', '🛡️', '🚀', '🏆'];
        const chosenEmoji = emojis[Math.floor(Math.random() * emojis.length)];

        // Build message
        let teks = `📢 *Admin Tag Alert*\n`;
        teks += `🏷️ *Group:* ${groupName}\n`;
        teks += `👥 *Admins:* ${admins.length}\n`;
        teks += `💬 *Message:* ${messageText}\n\n`;
        teks += `╭━━〔 *Admin Mentions* 〕━━┈⊷\n`;
        
        for (let admin of admins) {
            teks += `${chosenEmoji} @${admin.split("@")[0]}\n`;
        }

        teks += `╰──────────────┈⊷\n\n`;
        teks += `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send message with mentions
        await socket.sendMessage(sender, {
            text: teks,
            mentions: admins,
            contextInfo: {
                mentionedJid: admins,
                externalAdReply: {
                    title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
                    body: `${admins.length} ᴀᴅᴍɪɴs`,
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/254101022551',
                    thumbnailUrl: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg'
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("TagAdmins Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: `❌ *Error occurred:*\n${error.message || 'Failed to tag admins'}`
        }, { quoted: msg });
    }
    break;
}
//block case
// Case: block - Block a user
case 'block': {
    try {
        // Owner only check
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *Owner Only Command*\n\nThis command can only be used by the bot owner.',
                quoted: msg
            });
            break;
        }
        
        let target;
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const mentioned = ctx?.mentionedJid || [];
        
        // Get target user from mention or reply
        if (mentioned && mentioned.length > 0) {
            target = mentioned[0];
        } else if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
            target = ctx.participant;
        } else if (args[0]) {
            // Clean phone number
            let number = args[0].replace(/[^0-9]/g, '');
            if (number.startsWith('0')) {
                number = '254' + number.slice(1);
            }
            if (number.length === 9) {
                number = '254' + number;
            }
            target = number + '@s.whatsapp.net';
        } else {
            await socket.sendMessage(sender, {
                text: '❌ *Usage:*\n\n.block @user\n.block 254700000000\n\nOr reply to a user\'s message with .block',
                quoted: msg
            });
            break;
        }
        
        if (!target || !target.includes('@')) {
            await socket.sendMessage(sender, {
                text: '❌ Invalid user format. Use @mention or phone number.',
                quoted: msg
            });
            break;
        }
        
        // Block the user
        await socket.updateBlockStatus(target, 'block');
        
        // Send success message
        await socket.sendMessage(sender, {
            text: `✅ *User Blocked*\n\n┏━━━━━━━━━━━━━━━━━━┓\n┃ 🚫 User: @${target.split('@')[0]}\n┃ ✅ Status: BLOCKED\n┗━━━━━━━━━━━━━━━━━━┛\n\n> *CaseyRhodes Bot*`,
            mentions: [target],
            quoted: msg
        });
        
    } catch (error) {
        console.error('Block command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Error:* ${error.message}`,
            quoted: msg
        });
    }
    break;
}
// Case: details (Message Details)
case 'details': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📋", // Clipboard emoji
            key: msg.key
        }
    });

    const context = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;

    if (!quoted) {
        return await socket.sendMessage(sender, {
            text: '📋 *Please reply to a message to view its raw details!*\n\n' +
                  'This command shows the complete message structure.'
        }, { quoted: fakevCard });
    }

    try {
        const json = JSON.stringify(quoted, null, 2);
        const parts = json.match(/[\s\S]{1,3500}/g) || [];

        if (parts.length === 0) {
            return await socket.sendMessage(sender, {
                text: '❌ *No details available for this message.*'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, {
            text: `📋 *CaseyRhodes Message Details:*\n\n*Part 1/${parts.length}*`
        }, { quoted: fakevCard });

        for (let i = 0; i < parts.length; i++) {
            await socket.sendMessage(sender, {
                text: `\`\`\`json\n${parts[i]}\n\`\`\``
            });
            
            // Add small delay between messages to avoid rate limiting
            if (i < parts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (error) {
        console.error('Details command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to read quoted message details!*'
        }, { quoted: fakevCard });
    }
    break;
}
// Case: horoscope / zodiac / horo - Get daily horoscope
case 'horoscope':
case 'zodiac':
case 'horo': {
    try {
        const SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
        const EMOJIS = { aries:'♈',taurus:'♉',gemini:'♊',cancer:'♋',leo:'♌',virgo:'♍',libra:'♎',scorpio:'♏',sagittarius:'♐',capricorn:'♑',aquarius:'♒',pisces:'♓' };

        const sign = (args[0] || '').toLowerCase();
        
        if (!sign || !SIGNS.includes(sign)) {
            await socket.sendMessage(sender, {
                text: `🔮 *ʜᴏʀᴏsᴄᴏᴘᴇ*\n\nɢᴇᴛ ʏᴏᴜʀ ᴅᴀɪʟʏ ʜᴏʀᴏsᴄᴏᴘᴇ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}horo <sign>\`\n\n*ᴢᴏᴅɪᴀᴄ sɪɢɴs:*\n${SIGNS.map(s => `${EMOJIS[s]} ${s}`).join(', ')}\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}horo leo\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}horo leo`, buttonText: { displayText: '♌ ʟᴇᴏ' }, type: 1 },
                    { buttonId: `${prefix}horo gemini`, buttonText: { displayText: '♊ ɢᴇᴍɪɴɪ' }, type: 1 },
                    { buttonId: `${prefix}horo scorpio`, buttonText: { displayText: '♏ sᴄᴏʀᴘɪᴏ' }, type: 1 },
                    { buttonId: `${prefix}horo pisces`, buttonText: { displayText: '♓ ᴘɪsᴄᴇs' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });

        const { data } = await axios.get(
            `https://horoscope-app-api.vercel.app/api/v1/get-horoscope/daily?sign=${sign}&day=TODAY`,
            { timeout: 10000 }
        );
        
        const h = data?.data;
        const date = h?.date || new Date().toDateString();
        const horoscopeText = h?.horoscope_data || 'No horoscope available today.';

        await socket.sendMessage(sender, {
            text: `${EMOJIS[sign]} *${sign.charAt(0).toUpperCase() + sign.slice(1)} ᴅᴀɪʟʏ ʜᴏʀᴏsᴄᴏᴘᴇ*\n📅 ${date}\n\n${horoscopeText}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}horo`, buttonText: { displayText: '🔮 ᴀɴᴏᴛʜᴇʀ sɪɢɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Horoscope] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ʜᴏʀᴏsᴄᴏᴘᴇ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            buttons: [
                { buttonId: `${prefix}horo`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case pdf 
case 'topdf':
case 'pdf': {
    // React to the command
    await socket.sendMessage(sender, {
        react: {
            text: "📄",
            key: msg.key
        }
    });

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const args = q.trim().split(' ').slice(1);
    const textToConvert = args.join(' ');

    if (!textToConvert) {
        return await socket.sendMessage(sender, {
            text: '📄 *PDF Converter*\n\n' +
                  'Please provide text to convert to PDF.\n' +
                  'Example: *.topdf Hello World*',
            buttons: [
                { buttonId: '.topdf Sample PDF text', buttonText: { displayText: '📄 Example' }, type: 1 },
                { buttonId: '.help topdf', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        });
    }

    try {
        const PDFDocument = require('pdfkit');
        const { Buffer } = require('buffer');
        
        // Create a new PDF document
        const doc = new PDFDocument({
            margin: 50,
            size: 'A4'
        });
        
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', async () => {
            try {
                const pdfData = Buffer.concat(buffers);
                const fileName = `CASEYRHODES_${Date.now()}.pdf`;
                
                await socket.sendMessage(sender, {
                    document: pdfData,
                    mimetype: 'application/pdf',
                    fileName: fileName,
                    caption: `📄 *PDF created successfully!*\n\n` +
                            `*Filename:* ${fileName}\n` +
                            `*Text Length:* ${textToConvert.length} characters\n\n` +
                            `> © Created by CaseyRhodes XMD`,
                    contextInfo: {
                        mentionedJid: [sender]
                    }
                });
            } catch (sendError) {
                console.error('[PDF SEND ERROR]', sendError);
                await socket.sendMessage(sender, {
                    text: '❌ *Error sending PDF file!*\n\n' +
                          'File might be too large or corrupted.',
                    buttons: [
                        { buttonId: '.topdf', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                        { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
                    ]
                });
            }
        });

        // Add styling and content to the PDF
        doc.font('Helvetica-Bold')
           .fontSize(20)
           .text('CaseyRhodes PDF Document', { align: 'center' });
        
        doc.moveDown(0.5)
           .font('Helvetica')
           .fontSize(12)
           .text('Generated: ' + new Date().toLocaleString(), { align: 'center' });
        
        doc.moveDown(1)
           .fontSize(12)
           .text(textToConvert, {
               align: 'left',
               width: 500,
               lineGap: 5
           });
        
        // Add footer
        doc.moveDown(2)
           .fontSize(10)
           .font('Helvetica-Oblique')
           .text('© Created by CaseyRhodes XMD', { align: 'center' });

        // Finalize the PDF
        doc.end();

    } catch (e) {
        console.error('[PDF ERROR]', e);
        await socket.sendMessage(sender, {
            text: `❌ *Error creating PDF!*\n\n` +
                  `Error: ${e.message || 'Unknown error'}\n\n` +
                  'Please try again with different text.',
            buttons: [
                { buttonId: '.topdf', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        });
    }
    break;
}
// Case: setpp
case 'setpp': {
  try {
    await socket.sendMessage(sender, { react: { text: '🖼️', key: msg.key } });
    
    // Check if user is owner
    const isOwner = msg.key.fromMe;
    if (!isOwner) {
        await socket.sendMessage(from, { 
            text: '❌ *Owner Only Command*\n\nThis command is only available for the bot owner!' 
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '🚫', key: msg.key } });
        return;
    }

    // Check if message is a reply
    const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMessage) {
        await socket.sendMessage(from, { 
            text: '📸 *How to Use*\n\nPlease reply to an image with the `.setpp` command!\n\nExample: Reply to an image and type `.setpp`'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: 'ℹ️', key: msg.key } });
        return;
    }

    // Check if quoted message contains an image
    const imageMessage = quotedMessage.imageMessage || quotedMessage.stickerMessage;
    if (!imageMessage) {
        await socket.sendMessage(from, { 
            text: '❌ *Invalid Media*\n\nThe replied message must contain an image or sticker!\n\nSupported formats: JPG, PNG, WebP'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        return;
    }

    // Create tmp directory if it doesn't exist
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download the image
    await socket.sendMessage(from, { 
        text: '⏳ Downloading image...' 
    }, { quoted: msg });

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    let buffer = Buffer.from([]);
    
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    const imagePath = path.join(tmpDir, `profile_${Date.now()}.jpg`);
    
    // Save the image
    fs.writeFileSync(imagePath, buffer);

    await socket.sendMessage(from, { 
        text: '🔄 Setting profile picture...' 
    }, { quoted: msg });

    // Set the profile picture
    await socket.updateProfilePicture(socket.user.id, { url: imagePath });

    // Clean up the temporary file
    fs.unlinkSync(imagePath);

    await socket.sendMessage(from, { 
        text: '✅ *Profile Picture Updated!*\n\nBot profile picture has been successfully updated!' 
    }, { quoted: msg });
    
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

  } catch (error) {
    console.error('Error in setpp command:', error);
    
    let errorMessage = '❌ *Update Failed*\n\nFailed to update profile picture!';
    
    if (error.message.includes('rate')) {
        errorMessage = '❌ *Rate Limited*\n\nPlease wait a few minutes before changing profile picture again.';
    } else if (error.message.includes('size')) {
        errorMessage = '❌ *File Too Large*\n\nPlease use a smaller image file.';
    } else if (error.message.includes('format')) {
        errorMessage = '❌ *Invalid Format*\n\nPlease use a valid image format (JPG, PNG).';
    }
    
    await socket.sendMessage(from, { 
        text: errorMessage 
    }, { quoted: msg });
    
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
// Case: broadcast / bc - Broadcast message to all groups (owner only)
case 'broadcast':
case 'bc': {
    try {
        if (!isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*\n\nᴏɴʟʏ ᴛʜᴇ ʙᴏᴛ ᴏᴡɴᴇʀ ᴄᴀɴ ʙʀᴏᴀᴅᴄᴀsᴛ.',
                quoted: msg
            });
            break;
        }

        const text = args.join(' ').trim();
        
        if (!text) {
            await socket.sendMessage(sender, {
                text: `📢 *ʙʀᴏᴀᴅᴄᴀsᴛ*\n\nsᴇɴᴅ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ ᴀʟʟ ɢʀᴏᴜᴘs.\n\n*ᴜsᴀɢᴇ:* \`${prefix}bc ʏᴏᴜʀ ᴍᴇssᴀɢᴇ\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}bc ʜᴇʟʟᴏ ᴇᴠᴇʀʏᴏɴᴇ! ɪᴍᴘᴏʀᴛᴀɴᴛ ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛ!\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📢', key: msg.key } });

        // Fetch all groups
        let groups;
        try {
            groups = await socket.groupFetchAllParticipating();
        } catch (e) {
            await socket.sendMessage(sender, {
                text: `❌ *ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ ɢʀᴏᴜᴘs*\n\n${e.message}`,
                quoted: msg
            });
            break;
        }

        const groupJids = Object.keys(groups);
        
        if (!groupJids.length) {
            await socket.sendMessage(sender, {
                text: '❌ *ɴᴏ ɢʀᴏᴜᴘs*\n\nʙᴏᴛ ɪs ɴᴏᴛ ɪɴ ᴀɴʏ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        // Send status message
        await socket.sendMessage(sender, {
            text: `📢 *ʙʀᴏᴀᴅᴄᴀsᴛɪɴɢ...*\n\nsᴇɴᴅɪɴɢ ᴛᴏ *${groupJids.length}* ɢʀᴏᴜᴘ(s)...\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });

        // Broadcast to all groups
        let sent = 0, failed = 0;
        for (const g of groupJids) {
            try {
                await socket.sendMessage(g, {
                    text: `📢 *ʙʀᴏᴀᴅᴄᴀsᴛ*\n\n${text}\n\n> ${config.BOT_FOOTER}`
                });
                sent++;
                await new Promise(r => setTimeout(r, 800)); // Delay to avoid rate limits
            } catch {
                failed++;
            }
        }

        // Send completion message
        await socket.sendMessage(sender, {
            text: `✅ *ʙʀᴏᴀᴅᴄᴀsᴛ ᴄᴏᴍᴘʟᴇᴛᴇ!*\n\n📤 *sᴇɴᴛ:* ${sent}\n❌ *ғᴀɪʟᴇᴅ:* ${failed}\n📊 *ᴛᴏᴛᴀʟ:* ${groupJids.length} ɢʀᴏᴜᴘs\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}bc`, buttonText: { displayText: '📢 ʙʀᴏᴀᴅᴄᴀsᴛ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Broadcast] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ʙʀᴏᴀᴅᴄᴀsᴛ ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: blocklist (Blocked Users)
case 'blocklist':
case 'blocked': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🚫", // No entry emoji
            key: msg.key
        }
    });

    try {
        const blockedJids = await socket.fetchBlocklist();
        
        if (!blockedJids || blockedJids.length === 0) {
            return await socket.sendMessage(sender, {
                text: '✅ *Your block list is empty!* 🌟\n\n' +
                      'No users are currently blocked.',
                buttons: [
                    { buttonId: '.block', buttonText: { displayText: '🚫 Block User' }, type: 1 },
                    { buttonId: '.allmenu', buttonText: { displayText: '📋 Menu' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const formattedList = blockedJids.map((b, i) => 
            `${i + 1}. ${b.replace('@s.whatsapp.net', '')}`
        ).join('\n');

        await socket.sendMessage(sender, {
            text: `🚫 *Blocked Contacts:*\n\n${formattedList}\n\n` +
                  `*Total blocked:* ${blockedJids.length}\n\n` +
                  `> _Powered by CaseyRhodes Tech_ 🌟`,
            buttons: [
                { buttonId: '.unblock', buttonText: { displayText: '🔓 Unblock All' }, type: 1 },
                { buttonId: '.block', buttonText: { displayText: '🚫 Block More' }, type: 1 },
                { buttonId: '.allmenu', buttonText: { displayText: '📋 Main Menu' }, type: 1 }
            ]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('Error fetching block list:', error);
        await socket.sendMessage(sender, {
            text: '❌ *An error occurred while retrieving the block list!*\n\n' +
                  'This command may require admin privileges.',
            buttons: [
                { buttonId: '.help block', buttonText: { displayText: '❓ Help' }, type: 1 },
                { buttonId: '.allmenu', buttonText: { displayText: '📋 Menu' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
// Case: lyrics / lyric - Search song lyrics
case 'lyrics':
case 'lyric': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `🎵 *sᴏɴɢ ʟʏʀɪᴄs*\n\n*ᴜsᴀɢᴇ:* \`${prefix}lyrics <artist> - <song>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}lyrics Drake - God's Plan\`\n• \`${prefix}lyrics Ed Sheeran - Perfect\`\n• \`${prefix}lyrics Rihanna - Diamonds\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}lyrics Drake - God's Plan`, buttonText: { displayText: '🎵 ᴅʀᴀᴋᴇ' }, type: 1 },
                    { buttonId: `${prefix}lyrics Ed Sheeran - Perfect`, buttonText: { displayText: '🎵 ᴇᴅ sʜᴇᴇʀᴀɴ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });

        const query = args.join(' ');
        const sep = query.includes(' - ') ? query.split(' - ') : [null, query];
        const artist = sep[0]?.trim() || 'unknown';
        const title = sep[1]?.trim() || sep[0]?.trim() || query;

        const res = await axios.get(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
            { timeout: 12000 }
        );
        
        const raw = res.data?.lyrics;
        if (!raw) throw new Error('Not found');
        
        const lyrics = raw.trim().slice(0, 3500);
        const trunc = raw.length > 3500 ? '\n\n_[...truncated]_' : '';

        await socket.sendMessage(sender, {
            text: `🎵 *${title}* — ${artist}\n\n${lyrics}${trunc}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}lyrics`, buttonText: { displayText: '🎵 sᴇᴀʀᴄʜ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch {
        await socket.sendMessage(sender, {
            text: `❌ *ʟʏʀɪᴄs ɴᴏᴛ ғᴏᴜɴᴅ*\n\nᴛʀʏ: \`${prefix}lyrics Artist - Song Title\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}lyrics Drake - God's Plan\``,
            buttons: [
                { buttonId: `${prefix}lyrics`, buttonText: { displayText: '🎵 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
case 'play': {
    try {
        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "🎶",
                key: msg.key
            }
        });

        const axios = require('axios');
        const yts = require('yt-search');

        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '*🎵 Audio Player*\nPlease provide a song name to play.*'
            }, { quoted: msg });
        }

        console.log('[PLAY] Searching YT for:', query);
        const search = await yts(query);
        const video = search.videos[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: '*❌ No Results Found*\nNo songs found for your query. Please try different keywords.*'
            }, { quoted: msg });
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp3`;
        
        // Using the new API endpoint
        const apiURL = `https://api.giftedtech.co.ke/api/download/ytmp3?apikey=gifted&url=${encodeURIComponent(video.url)}`;

        // Create single button for getting video
        const buttonMessage = {
            image: { url: video.thumbnail },
            caption: `
🎧 *NOW PLAYING* 🎧

🎶 *Title:* ${video.title}
⏱️ *Duration:* ${video.timestamp}
👁️ *Views:* ${video.views}
📅 *Uploaded:* ${video.ago}
🔗 *YouTube URL:* ${video.url}

⬇️ *Downloading your audio...* ⬇️
            `.trim(),
            footer: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ - ᴀᴜᴅɪᴏ ᴘʟᴀʏᴇʀ',
            buttons: [
                {
                    buttonId: '.alive ' + video.title,
                    buttonText: { displayText: '👑 ALIVE' },
                    type: 1
                }
            ],
            headerType: 1
        };

        // Send song description with thumbnail and single button
        await socket.sendMessage(sender, buttonMessage, { quoted: msg });

        // Get download link from new API
        const response = await axios.get(apiURL, { timeout: 30000 });
        
        // Log the response to see its structure (for debugging)
        console.log('[PLAY] API Response:', JSON.stringify(response.data, null, 2));

        // Check different possible response structures
        let downloadUrl = null;
        
        if (response.data.download_url) {
            downloadUrl = response.data.download_url;
        } else if (response.data.download) {
            downloadUrl = response.data.download;
        } else if (response.data.url) {
            downloadUrl = response.data.url;
        } else if (response.data.result && response.data.result.download_url) {
            downloadUrl = response.data.result.download_url;
        } else if (response.data.data && response.data.data.url) {
            downloadUrl = response.data.data.url;
        } else if (typeof response.data === 'string' && response.data.startsWith('http')) {
            downloadUrl = response.data;
        }

        if (!downloadUrl) {
            console.log('[PLAY] Full API Response:', response.data);
            return await socket.sendMessage(sender, {
                text: '*❌ Download Failed*\nFailed to retrieve the MP3 download link. Please try again later.*'
            }, { quoted: msg });
        }

        // Send audio file without caption/success message
        await socket.sendMessage(sender, {
            audio: { url: downloadUrl },
            mimetype: 'audio/mpeg',
            fileName: fileName,
            ptt: false // Important: ensures it's treated as music, not voice message
        });

    } catch (err) {
        console.error('[PLAY] Error:', err.message);
        if (err.response) {
            console.error('[PLAY] API Error Response:', err.response.data);
        }
        await socket.sendMessage(sender, {
            text: '*❌ Error Occurred*\nUnable to process your request. Please try again later.*'
        }, { quoted: msg });
    }
    break;
}
  //=====[Song COMMAND]================//
//=====[Song COMMAND]================//

//video case
//=====[VIDEO COMMAND]================//
case 'video': {
    try {
        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "🎬",
                key: msg.key
            }
        });

        const axios = require('axios');
        const yts = require('yt-search');

        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ').trim();

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '*🎬 Video Downloader*\nPlease provide a video name to download.*'
            }, { quoted: msg });
        }

        console.log('[VIDEO] Searching YT for:', query);
        const search = await yts(query);
        const video = search.videos[0];

        if (!video) {
            return await socket.sendMessage(sender, {
                text: '*❌ No Results Found*\nNo videos found for your query. Please try different keywords.*'
            }, { quoted: msg });
        }

        const safeTitle = video.title.replace(/[\\/:*?"<>|]/g, '');
        const fileName = `${safeTitle}.mp4`;
        const apiURL = `${BASE_URL}/dipto/ytDl3?link=${encodeURIComponent(video.videoId)}&format=mp4`;

        // Create fancy video description with emojis and formatting
        const videoInfo = `
🎬 *NOW DOWNLOADING* 🎬

📹 *Title:* ${video.title}
⏱️ *Duration:* ${video.timestamp}
👁️ *Views:* ${video.views}
📅 *Uploaded:* ${video.ago}
🔗 *YouTube ID:* ${video.videoId}

⬇️ *Downloading your video...* ⬇️
        `.trim();

        // Send video info with thumbnail first
        await socket.sendMessage(sender, {
            image: { url: video.thumbnail },
            caption: videoInfo
        }, { quoted: msg });

        // Get download link
        const response = await axios.get(apiURL, { timeout: 30000 });
        const data = response.data;

        if (!data.downloadLink) {
            return await socket.sendMessage(sender, {
                text: '*❌ Download Failed*\nFailed to retrieve the MP4 download link. Please try again later.*'
            }, { quoted: msg });
        }

        // Fetch thumbnail for the context info
        let thumbnailBuffer;
        try {
            const thumbnailResponse = await axios.get(video.thumbnail, { 
                responseType: 'arraybuffer',
                timeout: 8000
            });
            thumbnailBuffer = Buffer.from(thumbnailResponse.data);
        } catch (err) {
            console.error('[VIDEO] Error fetching thumbnail:', err.message);
            thumbnailBuffer = undefined;
        }

        // Send video with context info after a short delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const videoMessage = {
            video: { url: data.downloadLink },
            mimetype: 'video/mp4',
            fileName: fileName,
            caption: `🎬 *${video.title}*\n⏱️ ${video.timestamp} | 👁️ ${video.views}\n\n📥 Downloaded by CaseyRhodes Mini`
        };

        // Add contextInfo only if we have a thumbnail
        if (thumbnailBuffer) {
            videoMessage.contextInfo = {
                externalAdReply: {
                    title: video.title.substring(0, 40),
                    body: `Duration: ${video.timestamp} | Views: ${video.views}`,
                    mediaType: 2, // 2 for video
                    thumbnail: thumbnailBuffer,
                    sourceUrl: `https://youtu.be/${video.videoId}`,
                    renderLargerThumbnail: false
                }
            };
        }

        await socket.sendMessage(sender, videoMessage);

    } catch (err) {
        console.error('[VIDEO] Error:', err.message);
        await socket.sendMessage(sender, {
            text: '*❌ Error Occurred*\nFailed to process your video request. Please try again later.*'
        }, { quoted: msg });
    }
    break;
}
case 'gjid':
case 'groupjid':
case 'grouplist': {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: "❌ You are not the owner!"
        }, { quoted: msg });
        return;
    }
    
    try {
        const groups = await socket.groupFetchAllParticipating();
        const groupJids = Object.keys(groups).map((jid, i) => `${i + 1}. ${jid}`).join('\n');
        
        await socket.sendMessage(sender, {
            text: `📝 *Group JIDs List:*\n\n${groupJids}\n\n*Total Groups:* ${Object.keys(groups).length}`,
            buttons: [
                { buttonId: `${prefix}gjid`, buttonText: { displayText: '🔄 Refresh' }, type: 1 },
                { buttonId: `${prefix}bc`, buttonText: { displayText: '📢 Broadcast' }, type: 1 },
                { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 Owner Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });
        
    } catch (error) {
        console.error("Error fetching groups:", error);
        await socket.sendMessage(sender, {
            text: `❌ Failed to fetch groups: ${error.message}`,
            buttons: [
                { buttonId: `${prefix}support`, buttonText: { displayText: '🆘 Support' }, type: 1 },
                { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 Owner Menu' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
    }
    break;
}

//===============================                
// 9
                case 'dllogo': { 
                await socket.sendMessage(sender, { react: { text: '🔋', key: msg.key } });
                    const q = args.join(" "); 
                    
                    if (!q) return await socket.sendMessage(from, { text: "Please give me a URL to capture the screenshot, love 😘" }, { quoted: fakevCard });
                    
                    try {
                        const res = await axios.get(q);
                        const images = res.data.result.download_url;

                        await socket.sendMessage(m.chat, {
                            image: { url: images },
                            caption: config.CAPTION
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await socket.sendMessage(from, {
                            text: `❌ Oh, sweetie, something went wrong with the logo... 💔 Try again?`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
//===========text maker====================    

//===============================
                case 'fancy': {
                await socket.sendMessage(sender, { react: { text: '🖋', key: msg.key } });
                    const axios = require("axios");
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: "❎ *Give me some text to make it fancy, sweetie 😘*\n\n📌 *Example:* `.fancy Malvin`"
                        });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, {
                                text: "❌ *Oh, darling, the fonts got shy! Try again later? 💔*"
                            });
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_ᴘᴏᴡᴇʀᴇᴅ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ`;

                        await socket.sendMessage(sender, {
                            text: finalMessage
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await socket.sendMessage(sender, {
                            text: "⚠️ *Something went wrong with the fonts, love 😢 Try again?*"
                        });
                    }
                    break;
                    }
// Case: tiktok / tt / ttdl / tiktokdl - Download TikTok video without watermark
case 'tiktok':
case 'tt':
case 'ttdl':
case 'tiktokdl': {
    try {
        const raw = args[0];
        const url = raw?.match(/(https?:\/\/[^\s]+)/)?.[0];

        if (!url || !/tiktok\.com|vt\.tiktok\.com/.test(url)) {
            await socket.sendMessage(sender, {
                text: `❌ *Invalid TikTok URL!*\n\nExample: .tiktok https://vt.tiktok.com/ZS...\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });

        const processingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Processing TikTok video...* (may take ~20 seconds)',
            quoted: msg
        });

        const ENDPOINTS = [
            {
                name: 'TikWM',
                url:  (u) => `https://tikwm.com/api/?url=${encodeURIComponent(u)}`,
                parse: (data) => {
                    if (!data?.data?.play) return null;
                    return { videoUrl: data.data.play, author: data.data.author, likes: data.data.digg_count };
                }
            },
            {
                name: 'Tiklydown',
                url:  (u) => `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(u)}`,
                parse: (data) => {
                    if (!data?.videoUrl) return null;
                    return { videoUrl: data.videoUrl, author: data.author, likes: data.stats?.digg_count };
                }
            }
        ];

        let result = null;
        for (const ep of ENDPOINTS) {
            try {
                const { data } = await axios.get(ep.url(url), {
                    timeout: 25000,
                    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }
                });
                result = ep.parse(data);
                if (result) { console.log(`[TikTok] Success via ${ep.name}`); break; }
            } catch (e) {
                console.warn(`[TikTok] ${ep.name} failed: ${e.message}`);
            }
        }

        // delete processing message
        try { await socket.sendMessage(sender, { delete: processingMsg.key }); } catch {}

        if (!result) {
            await socket.sendMessage(sender, {
                text: '❌ *All download methods failed.*\nThe video may be private or restricted.\n\n> ' + config.BOT_FOOTER,
                buttons: [
                    { buttonId: `${prefix}tt`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        // Download video directly as arraybuffer
        const vidResponse = await axios.get(result.videoUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const videoBuffer = Buffer.from(vidResponse.data);
        if (videoBuffer.length < 1024) throw new Error('Downloaded file too small');

        const authorName = result.author?.nickname || result.author?.name || 'Unknown';
        const likes = result.likes ?? 'N/A';
        const caption = `🎵 *TikTok*  •  👤 ${authorName}  •  ❤️ ${likes}\n\n> ${config.BOT_FOOTER}`;

        await socket.sendMessage(sender, {
            video: videoBuffer,
            caption: caption,
            buttons: [
                { buttonId: `${prefix}tt`, buttonText: { displayText: '🎵 ᴅᴏᴡɴʟᴏᴀᴅ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[TikTok] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *TikTok download failed:* ${error.message}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}tt`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//case newsletters 
case 'newsletter':
case 'cjid':
case 'id': {
    try {
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const channelLink = args.join(' ');

        if (!channelLink) {
            return await socket.sendMessage(sender, {
                text: '❎ *Please provide a WhatsApp Channel link.*\n\n📌 *Example:*\n.newsletter https://whatsapp.com/channel/xxxxxxxxxx'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
        if (!match) {
            return await socket.sendMessage(sender, {
                text: '⚠️ *Invalid channel link!*\n\nMake sure it looks like:\nhttps://whatsapp.com/channel/xxxxxxxxx'
            }, { quoted: msg });
        }

        const inviteId = match[1];
        let metadata;

        try {
            // Try to get newsletter metadata
            metadata = await socket.newsletterMetadata("invite", inviteId);
        } catch (error) {
            console.error('Newsletter metadata error:', error);
            return await socket.sendMessage(sender, {
                text: '🚫 *Failed to fetch channel info.*\nDouble-check the link and try again.'
            }, { quoted: msg });
        }

        if (!metadata?.id) {
            return await socket.sendMessage(sender, {
                text: '❌ *Channel not found or inaccessible.*'
            }, { quoted: msg });
        }

        const infoText = `
『 📡 ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ 』
*ID:* ${metadata.id}
*Name:* ${metadata.name || 'N/A'}
*Followers:* ${metadata.subscribers?.toLocaleString() || "N/A"}
*Created:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString() : "Unknown"}

> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send channel info with or without image
        if (metadata.preview) {
            await socket.sendMessage(sender, {
                image: { url: `https://pps.whatsapp.net${metadata.preview}` },
                caption: infoText,
                contextInfo: {
                    externalAdReply: {
                        title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
                        body: metadata.name || 'ᴄʜᴀɴɴᴇʟ',
                        mediaType: 1,
                        sourceUrl: channelLink,
                        thumbnailUrl: `https://pps.whatsapp.net${metadata.preview}`
                    }
                }
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: infoText,
                contextInfo: {
                    externalAdReply: {
                        title: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ',
                        body: metadata.name || 'Channel Details',
                        mediaType: 1,
                        sourceUrl: channelLink
                    }
                }
            }, { quoted: msg });
        }

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("Newsletter Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '⚠️ *An unexpected error occurred while fetching the channel info.*\nPlease try again with a valid channel link.'
        }, { quoted: msg });
    }
    break;
}
//view once test
//view once test
case 'viewonce':
case 'vv':
case 'reveal':
case 'unviewonce': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "👀",
            key: msg.key
        }
    });

    const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

    try {
        // Extract quoted message from your structure
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedImage = quoted?.imageMessage;
        const quotedVideo = quoted?.videoMessage;

        if (quotedImage && quotedImage.viewOnce) {
            // Download and send the image
            const stream = await downloadContentFromMessage(quotedImage, 'image');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    image: buffer, 
                    caption: quotedImage.caption || '📸 *View Once Image Revealed*',
                    fileName: 'revealed-image.jpg',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else if (quotedVideo && quotedVideo.viewOnce) {
            // Download and send the video
            const stream = await downloadContentFromMessage(quotedVideo, 'video');
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            
            await socket.sendMessage(
                sender, 
                { 
                    video: buffer, 
                    caption: quotedVideo.caption || '🎥 *View Once Video Revealed*',
                    fileName: 'revealed-video.mp4',
                    buttons: [
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 },
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴍᴇɴᴜ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
            
        } else {
            await socket.sendMessage(
                sender, 
                { 
                    text: '❌ *Please reply to a view-once image or video.*\n\n💡 *How to use:* Reply to a view-once message with `.viewonce`',
                    buttons: [
                        { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                        { buttonId: `${prefix}owner`, buttonText: { displayText: 'ℹ️ ʜᴇʟᴘ' }, type: 1 },
                        { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                    ]
                }, 
                { quoted: msg }
            );
        }

    } catch (error) {
        console.error('View Once Error:', error);
        
        await socket.sendMessage(
            sender, 
            { 
                text: `❌ *Failed to reveal view-once media*\n⚠️ *Error:* ${error.message || 'Unknown error'}`,
                buttons: [
                    { buttonId: `${prefix}allmenu`, buttonText: { displayText: '📱 ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: `${prefix}viewonce`, buttonText: { displayText: '🔄 ᴛʀʏ ᴀɢᴀɪɴ' }, type: 1 },
                    { buttonId: `${prefix}owner`, buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' }, type: 1 }
                ]
            }, 
            { quoted: msg }
        );
    }
    break;
}

//yts case 
case 'yts':
case 'ytsearch':
case 'search': {
  try {
    // Add reaction to indicate processing
    await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
    
    // Get search query from message
    const args = body.slice(config.PREFIX.length).trim().split(' ');
    args.shift(); // Remove the command itself
    const query = args.join(' ');
    
    if (!query) {
      await socket.sendMessage(from, {
        text: "❌ *What should I search?*\n\nExample:\n.yts Adele Hello"
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
      break;
    }
    
    // Send searching message
    await socket.sendMessage(from, {
      text: "🔍 *Searching YouTube…*\nHold tight, summoning the algorithm gods."
    }, { quoted: msg });
    
    try {
      const result = await yts(query);
      const videos = result.videos.slice(0, 5);
      
      if (!videos.length) {
        await socket.sendMessage(from, {
          text: "😵 *No results found.*\nYouTube shrugged."
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        break;
      }
      
      let text = `🎬 *YouTube Search Results*\n\n`;
      
      videos.forEach((v, i) => {
        text +=
          `*${i + 1}. ${v.title}*\n` +
          `⏱ ${v.timestamp} | 👁 ${v.views.toLocaleString()}\n` +
          `📺 ${v.author.name}\n` +
          `🔗 ${v.url}\n\n`;
      });
      
      text += `> ✨ Powered by *caseyrhodes YouTube Engine*`;
      
      await socket.sendMessage(from, {
        image: { url: videos[0].thumbnail },
        caption: text
      }, { quoted: msg });
      
      await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
      
    } catch (err) {
      await socket.sendMessage(from, {
        text: `❌ *Search Error:*\n${err.message}`
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
  } catch (error) {
    console.error('YouTube search error:', error);
    await socket.sendMessage(from, {
      text: "❌ *Failed to process YouTube search*"
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//image case 
// Pinterest Image Search Command
case 'img':
case 'image':
case 'pinterest':
case 'pin': {
    try {
        const query = args.join(" ");
        
        if (!query) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `🖼️ *Please provide search keywords*\n\n*Example:* ${config.PREFIX}img hacker setup`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } });
        
        // Send searching message
        await socket.sendMessage(from, {
            text: `🔍 *Searching images for:* "${query}"\n⏳ Please wait...`
        }, { quoted: fakevCard });

        const apiUrl = `https://christus-api.vercel.app/image/Pinterest?query=${encodeURIComponent(query)}&limit=20`;
        
        const response = await axios.get(apiUrl, { timeout: 15000 });

        if (!response.data || !response.data.status || !Array.isArray(response.data.results) || response.data.results.length === 0) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *No images found* for your search query.'
            }, { quoted: fakevCard });
        }

        // Filter valid image URLs
        const images = response.data.results
            .filter(item => 
                item.imageUrl && 
                /\.(jpg|jpeg|png|webp)$/i.test(item.imageUrl)
            );

        if (images.length === 0) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *No valid images found* for your search query.'
            }, { quoted: fakevCard });
        }

        // Store images in session for navigation
        if (!global.imageSessions) global.imageSessions = {};
        const sessionId = `${sender}_${Date.now()}`;
        global.imageSessions[sessionId] = {
            images: images,
            query: query,
            currentIndex: 0,
            total: images.length
        };

        // Send ONLY ONE image with buttons
        const currentImage = images[0];
        const title = currentImage.title && currentImage.title !== "No title" ? currentImage.title : query;
        
        // Create buttons for navigation
        const navigationButtons = [];
        
        // Add Previous button (disabled for first image)
        navigationButtons.push({
            buttonId: `${config.PREFIX}img_nav ${sessionId} prev`,
            buttonText: { displayText: '⬅️ PREV' },
            type: 1
        });
        
        // Add Next button if there are more images
        if (images.length > 1) {
            navigationButtons.push({
                buttonId: `${config.PREFIX}img_nav ${sessionId} next`,
                buttonText: { displayText: 'NEXT ➡️' },
                type: 1
            });
        }
        
        // Add Search Again button
        navigationButtons.push({
            buttonId: `${config.PREFIX}img ${query}`,
            buttonText: { displayText: '🔍 SEARCH AGAIN' },
            type: 1
        });
        
        // Add Menu button
        navigationButtons.push({
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: '📋 MAIN MENU' },
            type: 1
        });

        await socket.sendMessage(from, {
            image: { url: currentImage.imageUrl },
            caption: `🖼️ *Pinterest Image* ${1}/${images.length}\n\n` +
                    `📌 *Search:* ${query}\n` +
                    `📝 *Title:* ${title}\n\n` +
                    `> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 🎀`,
            buttons: navigationButtons,
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error("❌ Pinterest Image Error:", error.message);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `❌ *Failed to fetch images*\n\n` +
                  `• Error: ${error.message || 'API connection failed'}\n` +
                  `• Try again with different keywords\n` +
                  `• Or try: ${config.PREFIX}img wallpaper`
        }, { quoted: fakevCard });
    }
    break;
}

// Add navigation handler for image browsing
case 'img_nav': {
    try {
        const args2 = args;
        const sessionId = args2[0];
        const direction = args2[1];
        
        if (!sessionId || !direction || !global.imageSessions || !global.imageSessions[sessionId]) {
            return socket.sendMessage(from, {
                text: '❌ *Session expired*\nPlease search again using: ' + config.PREFIX + 'img [query]'
            }, { quoted: fakevCard });
        }
        
        const session = global.imageSessions[sessionId];
        let newIndex = session.currentIndex;
        
        if (direction === 'next') {
            newIndex = session.currentIndex + 1;
        } else if (direction === 'prev') {
            newIndex = session.currentIndex - 1;
        }
        
        if (newIndex < 0 || newIndex >= session.total) {
            return socket.sendMessage(from, {
                text: `❌ *No more images*\nYou are at the ${direction === 'next' ? 'last' : 'first'} image.`
            }, { quoted: fakevCard });
        }
        
        // Update current index
        session.currentIndex = newIndex;
        
        const currentImage = session.images[newIndex];
        const title = currentImage.title && currentImage.title !== "No title" ? currentImage.title : session.query;
        
        // Create updated navigation buttons
        const navigationButtons = [];
        
        // Add Previous button (disabled if at first)
        navigationButtons.push({
            buttonId: `${config.PREFIX}img_nav ${sessionId} prev`,
            buttonText: { displayText: '⬅️ PREV' },
            type: 1
        });
        
        // Add Next button (disabled if at last)
        navigationButtons.push({
            buttonId: `${config.PREFIX}img_nav ${sessionId} next`,
            buttonText: { displayText: 'NEXT ➡️' },
            type: 1
        });
        
        // Add Search Again button
        navigationButtons.push({
            buttonId: `${config.PREFIX}img ${session.query}`,
            buttonText: { displayText: '🔍 SEARCH AGAIN' },
            type: 1
        });
        
        // Add Menu button
        navigationButtons.push({
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: '📋 MAIN MENU' },
            type: 1
        });
        
        await socket.sendMessage(from, {
            image: { url: currentImage.imageUrl },
            caption: `🖼️ *Pinterest Image* ${newIndex + 1}/${session.total}\n\n` +
                    `📌 *Search:* ${session.query}\n` +
                    `📝 *Title:* ${title}\n\n` +
                    `> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 🎀`,
            buttons: navigationButtons,
            headerType: 1,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error("❌ Navigation Error:", error.message);
        await socket.sendMessage(from, {
            text: '❌ *Error navigating images*\nPlease search again.'
        }, { quoted: fakevCard });
    }
    break;
}
/// CASEYRHODESTECH ANIME CASE 
// Anime image commands
case 'garl':
case 'imgloli':
case 'loli': {
    await socket.sendMessage(sender, {
        react: {
            text: "😎",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.lolicon.app/setu/v2?num=1&r18=0&tag=lolicon');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.data[0].urls.original },
            caption: '😎 *Random Garl Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[LOLI ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch loli image. Please try again.'
        });
    }
    break;
}

case 'waifu':
case 'imgwaifu': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/waifu');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💫 *Random Waifu Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[WAIFU ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch waifu image. Please try again.'
        });
    }
    break;
}

case 'neko':
case 'imgneko': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/neko');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💫 *Random Neko Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[NEKO ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch neko image. Please try again.'
        });
    }
    break;
}

case 'megumin':
case 'imgmegumin': {
    await socket.sendMessage(sender, {
        react: {
            text: "💕",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/megumin');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '💕 *Random Megumin Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[MEGUMIN ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch megumin image. Please try again.'
        });
    }
    break;
}

case 'maid':
case 'imgmaid': {
    await socket.sendMessage(sender, {
        react: {
            text: "💫",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.im/search/?included_tags=maid');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.images[0].url },
            caption: '💫 *Random Maid Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[MAID ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch maid image. Please try again.'
        });
    }
    break;
}

case 'awoo':
case 'imgawoo': {
    await socket.sendMessage(sender, {
        react: {
            text: "😎",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/awoo');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '😎 *Random Awoo Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[AWOO ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch awoo image. Please try again.'
        });
    }
    break;
}

case 'animegirl':
case 'animegirl1':
case 'animegirl2':
case 'animegirl3':
case 'animegirl4':
case 'animegirl5': {
    await socket.sendMessage(sender, {
        react: {
            text: "🧚🏻",
            key: msg.key
        }
    });
    
    try {
        const axios = require('axios');
        const res = await axios.get('https://api.waifu.pics/sfw/waifu');
        
        await socket.sendMessage(sender, {
            image: { url: res.data.url },
            caption: '🧚🏻 *Random Anime Girl Image*\n\n© CaseyRhodes XMD'
        });
    } catch (e) {
        console.error('[ANIME GIRL ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch anime girl image. Please try again.'
        });
    }
    break;
}

case 'anime':
case 'anime1':
case 'anime2':
case 'anime3':
case 'anime4':
case 'anime5': {
    await socket.sendMessage(sender, {
        react: {
            text: "⛱️",
            key: msg.key
        }
    });
    
    try {
        // Different image sets based on command
        let images = [];
        
        switch(command) {
            case 'anime':
                images = [
                    'https://telegra.ph/file/b26f27aa5daaada031b90.jpg',
                    'https://telegra.ph/file/51b44e4b086667361061b.jpg',
                    'https://telegra.ph/file/7d165d73f914985542537.jpg',
                    'https://telegra.ph/file/3d9732d2657d2d72dc102.jpg',
                    'https://telegra.ph/file/8daf7e432a646f3ebe7eb.jpg',
                    'https://telegra.ph/file/7514b18ea89da924e7496.jpg',
                    'https://telegra.ph/file/ce9cb5acd2cec7693d76b.jpg'
                ];
                break;
            case 'anime1':
                images = [
                    'https://i.waifu.pics/aD7t0Bc.jpg',
                    'https://i.waifu.pics/PQO5wPN.jpg',
                    'https://i.waifu.pics/5At1P4A.jpg',
                    'https://i.waifu.pics/MjtH3Ha.jpg',
                    'https://i.waifu.pics/QQW7VKy.jpg'
                ];
                break;
            case 'anime2':
                images = [
                    'https://i.waifu.pics/0r1Bn88.jpg',
                    'https://i.waifu.pics/2Xdpuov.png',
                    'https://i.waifu.pics/0hx-3AP.png',
                    'https://i.waifu.pics/q054x0_.png',
                    'https://i.waifu.pics/4lyqRvd.jpg'
                ];
                break;
            case 'anime3':
                images = [
                    'https://i.waifu.pics/gnpc_Lr.jpeg',
                    'https://i.waifu.pics/P6X-ph6.jpg',
                    'https://i.waifu.pics/~p5W9~k.png',
                    'https://i.waifu.pics/7Apu5C9.jpg',
                    'https://i.waifu.pics/OTRfON6.jpg'
                ];
                break;
            case 'anime4':
                images = [
                    'https://i.waifu.pics/aGgUm80.jpg',
                    'https://i.waifu.pics/i~RQhRD.png',
                    'https://i.waifu.pics/94LH-aU.jpg',
                    'https://i.waifu.pics/V8hvqfK.jpg',
                    'https://i.waifu.pics/lMiXE7j.png'
                ];
                break;
            case 'anime5':
                images = [
                    'https://i.waifu.pics/-ABlAvr.jpg',
                    'https://i.waifu.pics/HNEg0-Q.png',
                    'https://i.waifu.pics/3x~ovC6.jpg',
                    'https://i.waifu.pics/brv-GJu.jpg',
                    'https://i.waifu.pics/FWE8ggD.png'
                ];
                break;
            default:
                images = [
                    'https://telegra.ph/file/b26f27aa5daaada031b90.jpg',
                    'https://telegra.ph/file/51b44e4b086667361061b.jpg'
                ];
        }
        
        // Send images one by one
        for (let i = 0; i < Math.min(images.length, 3); i++) { // Limit to 3 images
            await socket.sendMessage(sender, {
                image: { url: images[i] },
                caption: i === 0 ? '⛱️ *Anime Images*\n\n© CaseyRhodes XMD' : ''
            });
            if (i < images.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between images
            }
        }
        
    } catch (e) {
        console.error('[ANIME IMAGES ERROR]', e);
        await socket.sendMessage(sender, {
            text: '❌ Failed to fetch anime images. Please try again.'
        });
    }
    break;
}
//caseyrhodes logo Caseyrhodes 
// 🎌 ANIME & GAME LOGOS
case 'dragonball': {
    await socket.sendMessage(sender, { react: { text: "🐉", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🐉 DRAGON BALL LOGO*\n\nPlease provide text\nExample: *${prefix}dragonball YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🐉 Generating Dragon Ball Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🐉 DRAGON BALL LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}dragonball ${query}`, buttonText: { displayText: '✨ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Dragonball logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Dragon Ball logo`
        }, { quoted: msg });
    }
    break;
}

case 'naruto': {
    await socket.sendMessage(sender, { react: { text: "🌀", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌀 NARUTO LOGO*\n\nPlease provide text\nExample: *${prefix}naruto YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🌀 Generating Naruto Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/naruto-shippuden-logo-style-text-effect-online-808.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌀 NARUTO LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}naruto ${query}`, buttonText: { displayText: '🌀 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Naruto logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Naruto logo`
        }, { quoted: msg });
    }
    break;
}

case 'arena': {
    await socket.sendMessage(sender, { react: { text: "⚔️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*⚔️ ARENA LOGO*\n\nPlease provide text\nExample: *${prefix}arena YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*⚔️ Generating Arena Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*⚔️ ARENA LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}arena ${query}`, buttonText: { displayText: '⚔️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Arena logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Arena logo`
        }, { quoted: msg });
    }
    break;
}

// 💻 MODERN & TECH LOGOS
case 'hacker': {
    await socket.sendMessage(sender, { react: { text: "💻", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💻 HACKER LOGO*\n\nPlease provide text\nExample: *${prefix}hacker YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*💻 Generating Hacker Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💻 HACKER LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}hacker ${query}`, buttonText: { displayText: '💻 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Hacker logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Hacker logo`
        }, { quoted: msg });
    }
    break;
}

case 'mechanical': {
    await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*⚙️ MECHANICAL LOGO*\n\nPlease provide text\nExample: *${prefix}mechanical YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*⚙️ Generating Mechanical Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-your-name-in-a-mechanical-style-306.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*⚙️ MECHANICAL LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}mechanical ${query}`, buttonText: { displayText: '⚙️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Mechanical logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Mechanical logo`
        }, { quoted: msg });
    }
    break;
}

case 'incandescent': {
    await socket.sendMessage(sender, { react: { text: "💡", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💡 INCANDESCENT LOGO*\n\nPlease provide text\nExample: *${prefix}incandescent YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*💡 Generating Incandescent Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/text-effects-incandescent-bulbs-219.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💡 INCANDESCENT LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}incandescent ${query}`, buttonText: { displayText: '💡 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Incandescent logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Incandescent logo`
        }, { quoted: msg });
    }
    break;
}

case 'gold': {
    await socket.sendMessage(sender, { react: { text: "🏆", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🏆 GOLD LOGO*\n\nPlease provide text\nExample: *${prefix}gold YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: `*🏆 Generating Gold Logo...*`
        }, { quoted: msg });

        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/modern-gold-4-213.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🏆 GOLD LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}gold ${query}`, buttonText: { displayText: '🏆 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Gold logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Gold logo`
        }, { quoted: msg });
    }
    break;
}

// 🌈 NATURE & EFFECT LOGOS
case 'sand': {
    await socket.sendMessage(sender, { react: { text: "🏖️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🏖️ SAND LOGO*\n\nPlease provide text\nExample: *${prefix}sand YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🏖️ SAND LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}sand ${query}`, buttonText: { displayText: '🏖️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Sand logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Sand logo`
        }, { quoted: msg });
    }
    break;
}

case 'sunset': {
    await socket.sendMessage(sender, { react: { text: "🌅", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌅 SUNSET LOGO*\n\nPlease provide text\nExample: *${prefix}sunset YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-sunset-light-text-effects-online-807.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌅 SUNSET LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}sunset ${query}`, buttonText: { displayText: '🌅 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Sunset logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Sunset logo`
        }, { quoted: msg });
    }
    break;
}

case 'water': {
    await socket.sendMessage(sender, { react: { text: "💧", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💧 WATER LOGO*\n\nPlease provide text\nExample: *${prefix}water YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-water-effect-text-online-295.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💧 WATER LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}water ${query}`, buttonText: { displayText: '💧 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Water logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Water logo`
        }, { quoted: msg });
    }
    break;
}

case 'rain': {
    await socket.sendMessage(sender, { react: { text: "🌧️", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🌧️ RAIN LOGO*\n\nPlease provide text\nExample: *${prefix}rain YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/foggy-rainy-text-effect-75.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🌧️ RAIN LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}rain ${query}`, buttonText: { displayText: '🌧️ CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Rain logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Rain logo`
        }, { quoted: msg });
    }
    break;
}

// 🎨 ART & CREATIVE LOGOS
case 'chocolate': {
    await socket.sendMessage(sender, { react: { text: "🍫", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🍫 CHOCOLATE LOGO*\n\nPlease provide text\nExample: *${prefix}chocolate YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/chocolate-text-effect-353.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🍫 CHOCOLATE LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}chocolate ${query}`, buttonText: { displayText: '🍫 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Chocolate logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Chocolate logo`
        }, { quoted: msg });
    }
    break;
}

case 'graffiti': {
    await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🎨 GRAFFITI LOGO*\n\nPlease provide text\nExample: *${prefix}graffiti YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/create-a-cartoon-style-graffiti-text-effect-online-668.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🎨 GRAFFITI LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}graffiti ${query}`, buttonText: { displayText: '🎨 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Graffiti logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Graffiti logo`
        }, { quoted: msg });
    }
    break;
}

case 'boom': {
    await socket.sendMessage(sender, { react: { text: "💥", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*💥 BOOM LOGO*\n\nPlease provide text\nExample: *${prefix}boom YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/boom-text-comic-style-text-effect-675.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*💥 BOOM LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}boom ${query}`, buttonText: { displayText: '💥 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Boom logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Boom logo`
        }, { quoted: msg });
    }
    break;
}

case 'purple': {
    await socket.sendMessage(sender, { react: { text: "🟣", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🟣 PURPLE LOGO*\n\nPlease provide text\nExample: *${prefix}purple YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/purple-text-effect-online-100.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🟣 PURPLE LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}purple ${query}`, buttonText: { displayText: '🟣 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Purple logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Purple logo`
        }, { quoted: msg });
    }
    break;
}

// 📝 TEXT & TYPOGRAPHY LOGOS
case 'cloth': {
    await socket.sendMessage(sender, { react: { text: "👕", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*👕 CLOTH LOGO*\n\nPlease provide text\nExample: *${prefix}cloth YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/text-on-cloth-effect-62.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*👕 CLOTH LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}cloth ${query}`, buttonText: { displayText: '👕 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Cloth logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Cloth logo`
        }, { quoted: msg });
    }
    break;
}

case '1917': {
    await socket.sendMessage(sender, { react: { text: "🎬", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🎬 1917 LOGO*\n\nPlease provide text\nExample: *${prefix}1917 YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/1917-style-text-effect-523.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🎬 1917 LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}1917 ${query}`, buttonText: { displayText: '🎬 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('1917 logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate 1917 logo`
        }, { quoted: msg });
    }
    break;
}

case 'child': {
    await socket.sendMessage(sender, { react: { text: "👶", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*👶 CHILD LOGO*\n\nPlease provide text\nExample: *${prefix}child YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/write-text-on-wet-glass-online-589.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*👶 CHILD LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}child ${query}`, buttonText: { displayText: '👶 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Child logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Child logo`
        }, { quoted: msg });
    }
    break;
}

case 'cat': {
    await socket.sendMessage(sender, { react: { text: "🐱", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*🐱 CAT LOGO*\n\nPlease provide text\nExample: *${prefix}cat YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/handwritten-text-on-foggy-glass-online-680.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*🐱 CAT LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}cat ${query}`, buttonText: { displayText: '🐱 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Cat logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Cat logo`
        }, { quoted: msg });
    }
    break;
}

case 'typo': {
    await socket.sendMessage(sender, { react: { text: "📝", key: msg.key } });
    
    const mumaker = require('mumaker');
    const q = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const args = q.trim().split(' ').slice(1);
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: `*📝 TYPO LOGO*\n\nPlease provide text\nExample: *${prefix}typo YourText*`,
            footer: `CaseyRhodes Tech`
        }, { quoted: msg });
    }

    try {
        const result = await mumaker.ephoto(
            'https://en.ephoto360.com/typography-text-effect-on-pavement-online-774.html',
            query
        );

        await socket.sendMessage(sender, {
            image: { url: result.image },
            caption: `*📝 TYPO LOGO*\n\n✨ *Text:* ${query}`,
            footer: `CaseyRhodes Tech`,
            buttons: [{ buttonId: `${prefix}typo ${query}`, buttonText: { displayText: '📝 CREATE AGAIN' }, type: 1 }]
        }, { quoted: msg });

    } catch (error) {
        console.error('Typo logo error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ ERROR*\nFailed to generate Typo logo`
        }, { quoted: msg });
    }
    break;
}
//zip case 
//web zip 
case 'webzip':
case 'sitezip':
case 'web':
case 'archive': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const url = args[0];

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a URL*\nExample: .webzip https://example.com'
            }, { quoted: msg });
        }

        if (!url.match(/^https?:\/\//)) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid URL*\nPlease use http:// or https://'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const apiUrl = `https://api.giftedtech.web.id/api/tools/web2zip?apikey=gifted&url=${encodeURIComponent(url)}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });

        if (!response.data?.success || !response.data?.result?.download_url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Failed to archive website*\nSite may be restricted, too large, or unavailable.'
            }, { quoted: msg });
        }

        const { siteUrl, copiedFilesAmount, download_url } = response.data.result;

        const caption = `
╭───[ *ᴡᴇʙᴢɪᴘ* ]───
├ *sɪᴛᴇ*: ${siteUrl} 🌐
├ *ғɪʟᴇs*: ${copiedFilesAmount} 📂
╰───[ *ᴄᴀsᴇʏʀʜᴏᴅᴇs* ]───
> *powered by caseyrhodes* ⚡`;

        // Send archiving message
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Archiving website... This may take a while* 📦'
        }, { quoted: msg });

        try {
            const zipResponse = await axios.get(download_url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!zipResponse.data) {
                throw new Error('Empty zip response');
            }

            const zipBuffer = Buffer.from(zipResponse.data, 'binary');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `website_archive_${timestamp}.zip`;

            // Send the zip file with buttons
            const zipMessage = {
                document: zipBuffer,
                fileName: filename,
                mimetype: 'application/zip',
                caption: `${caption}\n✅ *Archive downloaded successfully*`,
                footer: 'Website archived successfully',
                buttons: [
                    {
                        buttonId: `.webzip ${url}`,
                        buttonText: { displayText: '🔄 Archive Again' },
                        type: 1
                    },
                    {
                        buttonId: '.allmenu',
                        buttonText: { displayText: '❓ Tools Help' },
                        type: 1
                    }
                ],
                headerType: 4,
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'Website Archive',
                        body: `${copiedFilesAmount} files archived`,
                        mediaType: 1,
                        sourceUrl: url,
                        thumbnail: Buffer.from('') // Optional: add thumbnail
                    }
                }
            };

            await socket.sendMessage(sender, zipMessage, { quoted: msg });

            // Delete loading message
            await socket.sendMessage(sender, {
                delete: loadingMsg.key
            });

            // Send success reaction
            await socket.sendMessage(sender, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (downloadError) {
            console.error('Zip download error:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download archive*\nFile may be too large or download timed out.'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Webzip error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        let errorMsg = '❌ *Error archiving website*';
        
        if (error.message.includes('timeout')) {
            errorMsg = '❌ *Request timed out*\nPlease try again with a smaller website.';
        } else if (error.code === 'ENOTFOUND') {
            errorMsg = '❌ *API service unavailable*\nTry again later.';
        } else if (error.response?.status === 404) {
            errorMsg = '❌ *Website not found or inaccessible*';
        }

        await socket.sendMessage(sender, {
            text: errorMsg
        }, { quoted: msg });
    }
    break;
}
//screenshot case
case 'screenshot':
case 'ss':
case 'ssweb': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const url = args[0];

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid URL.*\nExample: `.screenshot https://github.com`'
            }, { quoted: msg });
        }

        // Validate the URL
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Invalid URL.* Please include "http://" or "https://".'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Generate the screenshot URL using Thum.io API
        const screenshotUrl = `https://image.thum.io/get/fullpage/${url}`;

        // Send the screenshot as an image message
        await socket.sendMessage(sender, {
            image: { url: screenshotUrl },
            caption: `🌐 *Website Screenshot*\n\n🔗 *URL:* ${url}\n\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: 'Website Screenshot',
                    body: 'Powered by Thum.io API',
                    mediaType: 1,
                    sourceUrl: url,
                    thumbnailUrl: screenshotUrl
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error("Screenshot Error:", error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        
        await socket.sendMessage(sender, {
            text: '❌ *Failed to capture the screenshot.*\nThe website may be blocking screenshots or the URL might be invalid.'
        }, { quoted: msg });
    }
    break;
}
//tts case
case 'tts': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🔊",
            key: msg.key
        }
    });

    const googleTTS = require('google-tts-api');

    try {
        // Extract text from message
        const q = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
        
        const args = q.split(' ').slice(1);
        const text = args.join(' ').trim();

        if (!text) {
            return await socket.sendMessage(sender, {
                text: "❌ *Please provide some text to convert to speech.*\n\n*Example:* .tts Hello world"
            }, { quoted: msg });
        }

        const url = googleTTS.getAudioUrl(text, {
            lang: 'en-US',
            slow: false,
            host: 'https://translate.google.com',
        });

        // Send the audio
        await socket.sendMessage(sender, { 
            audio: { url: url }, 
            mimetype: 'audio/mpeg', 
            ptt: false,
            caption: `🔊 *Text to Speech*\n📝 *Text:* ${text}\n\n✨ *Powered by CASEYRHODES-TECH*`
        }, { quoted: msg });

    } catch (e) {
        console.error('TTS Error:', e);
        await socket.sendMessage(sender, {
            text: `❌ *Error:* ${e.message || e}`
        }, { quoted: msg });
    }
    break;
}
//fetch case
//fetch case
case 'fetch':
case 'get':
case 'api': {
    await socket.sendMessage(sender, {
        react: { text: "🌐", key: msg.key }
    });

    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || '';
    
    const args = q.split(' ').slice(1);
    const url = args.join(' ').trim();

    if (!url) {
        return await socket.sendMessage(sender, {
            text: '*❌ Please provide a URL!*\n*Examples:*\n.fetch https://jsonplaceholder.typicode.com/posts/1\n.get https://api.github.com/users/caseyrhodes'
        }, { quoted: msg });
    }

    if (!/^https?:\/\//.test(url)) {
        return await socket.sendMessage(sender, {
            text: '*❌ Invalid URL format! Must start with http:// or https://*'
        }, { quoted: msg });
    }

    try {
        const axios = require('axios');
        const response = await axios.get(url, { timeout: 15000 });
        const data = response.data;
        
        let content = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);

        // If content is too large, send as file
        if (content.length > 2000) {
            const filename = `fetched_data_${Date.now()}.json`;
            
            await socket.sendMessage(sender, {
                document: Buffer.from(content),
                fileName: filename,
                mimetype: 'application/json',
                caption: `🌐 *FETCHED DATA* 🌐\n\n` +
                        `*URL:* ${url}\n` +
                        `*Status:* ${response.status}\n` +
                        `*Size:* ${content.length} characters\n` +
                        `*Sent as file due to large size*\n\n` +
                        `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: `🌐 *FETCHED DATA* 🌐\n\n` +
                      `*URL:* ${url}\n` +
                      `*Status:* ${response.status}\n` +
                      `*Size:* ${content.length} characters\n\n` +
                      `\`\`\`${content}\`\`\`\n\n` +
                      `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Fetch error:', error);
        
        await socket.sendMessage(sender, {
            text: `❌ *FETCH FAILED* ❌\n\n` +
                  `*URL:* ${url}\n` +
                  `*Error:* ${error.message}\n\n` +
                  `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🌟`
        }, { quoted: msg });
    }
    break;
}
//case wallpaper 
case 'rw':
case 'randomwall':
case 'wallpaper': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const query = args.join(' ') || 'random';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Send fetching message
        await socket.sendMessage(sender, {
            text: `🔍 *Fetching wallpaper for* \"${query}\"...`
        }, { quoted: msg });

        const apiUrl = `https://pikabotzapi.vercel.app/random/randomwall/?apikey=anya-md&query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl, { timeout: 15000 });

        if (!data?.status || !data?.imgUrl) {
            await socket.sendMessage(sender, {
                text: `❌ *No wallpaper found for* \"${query}\" 😔\nTry a different keyword.`
            }, { quoted: msg });
            
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return;
        }

        const caption = `
╭━━〔*🌌 ᴡᴀʟʟᴘᴀᴘᴇʀ* 〕━━┈⊷
├ *ᴋᴇʏᴡᴏʀᴅ*: ${query}
╰──────────────┈⊷
> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send wallpaper with buttons
        const wallpaperMessage = {
            image: { url: data.imgUrl },
            caption: caption,
            footer: 'Choose an option below',
            buttons: [
                {
                    buttonId: `.rw ${query}`,
                    buttonText: { displayText: '🔄 Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '❓ Help' },
                    type: 1
                }
            ],
            headerType: 4,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                externalAdReply: {
                    title: 'Random Wallpaper',
                    body: `Keyword: ${query}`,
                    mediaType: 1,
                    sourceUrl: data.imgUrl,
                    thumbnailUrl: data.imgUrl
                }
            }
        };

        await socket.sendMessage(sender, wallpaperMessage, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Wallpaper error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        let errorMsg = '❌ *Failed to fetch wallpaper* 😞';
        
        if (error.message.includes('timeout')) {
            errorMsg = '❌ *Request timed out* ⏰\nPlease try again.';
        } else if (error.code === 'ENOTFOUND') {
            errorMsg = '❌ *API service unavailable* 🔧\nTry again later.';
        } else if (error.response?.status === 404) {
            errorMsg = '❌ *Wallpaper API not found* 🚫';
        }

        await socket.sendMessage(sender, {
            text: errorMsg
        }, { quoted: msg });
    }
    break;
}
//case URL 
case 'tourl':
case 'upload':
case 'tourl2': {
    try {
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const mediaMsg = (quoted && (quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)) ||
                        msg.message?.imageMessage ||
                        msg.message?.videoMessage ||
                        msg.message?.audioMessage;

        if (!mediaMsg) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `⚠️ Reply to image/video/audio with *${config.PREFIX}tourl*`
            }, { quoted: fakevCard });
        }

        const mime = mediaMsg.mimetype || '';
        if (!/image|video|audio/.test(mime)) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '⚠️ Only images, videos & audio allowed'
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        // Download media
        const stream = await downloadContentFromMessage(mediaMsg, mime.split('/')[0]);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }

        // Create temp file
        const ext = mime.split('/')[1] || 'bin';
        const tempDir = path.join(__dirname, '../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFile = path.join(tempDir, `catbox_${Date.now()}.${ext}`);
        fs.writeFileSync(tempFile, buffer);

        // Upload to Catbox
        const form = new FormData();
        form.append('reqtype', 'fileupload');
        form.append('fileToUpload', fs.createReadStream(tempFile));

        const response = await axios.post('https://catbox.moe/user/api.php', form, { 
            headers: form.getHeaders(),
            timeout: 30000 
        });
        
        const url = response.data?.trim();
        fs.unlinkSync(tempFile);

        if (!url || !url.startsWith('https')) {
            throw new Error("Upload failed");
        }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

        // Send success message with ONE button
        await socket.sendMessage(from, {
            text: `✅ *Upload Successful!*\n🔗 ${url}`,
            buttons: [
                {
                    urlButton: {
                        displayText: "🔗 Open URL",
                        url: url
                    }
                }
            ]
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('❌ Tourl Error:', error);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `❌ Upload failed: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
///case quran
case 'quran': {
    try {
        const query = args.join(" ");
        
        if (!query) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: `☪️ *Example:* ${config.PREFIX}quran 2:255\n\n👉 *Format:* Surah:Ayah (e.g., 2:255 for Ayatul Kursi)`
            }, { quoted: fakevCard });
        }

        await socket.sendMessage(sender, { react: { text: '📿', key: msg.key } });

        const [surah, ayah] = query.split(":");

        if (!surah || !ayah) {
            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
            return socket.sendMessage(from, {
                text: '❌ *Please use format:* Surah:Ayah\n*Example:* 2:255'
            }, { quoted: fakevCard });
        }

        const response = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/en.asad`);
        
        if (!response.data || !response.data.data) {
            throw new Error('Invalid response from Quran API');
        }

        const verse = response.data.data;

        const quranMessage = {
            text: `🕋 *QURAN VERSE* 🕋\n\n` +
                  `━━━━━━━━━━━━━━━━\n\n` +
                  `📖 *Surah:* ${verse.surah.englishName}\n` +
                  `📝 *Translation:* ${verse.surah.englishNameTranslation}\n` +
                  `🔢 *Ayah Number:* ${verse.numberInSurah}\n` +
                  `📍 *Juz:* ${verse.juz}\n\n` +
                  `✨ *Verse:*\n"${verse.text}"\n\n` +
                  `🌍 *Translation (Muhammad Asad):*\n${verse.text}\n\n` +
                  `━━━━━━━━━━━━━━━━\n` +
                  `> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 🎀`,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            }
        };

        await socket.sendMessage(from, quranMessage, { quoted: fakevCard });
        
        // Send buttons for quick access
        await socket.sendMessage(from, {
            text: "📖 *Quran Options*",
            buttons: [
                {
                    quickReplyButton: {
                        displayText: "🔄 Another Verse",
                        id: `${config.PREFIX}quran`
                    }
                },
                {
                    quickReplyButton: {
                        displayText: "📜 Ayatul Kursi",
                        id: `${config.PREFIX}quran 2:255`
                    }
                },
                {
                    quickReplyButton: {
                        displayText: "📋 Main Menu",
                        id: `${config.PREFIX}menu`
                    }
                }
            ]
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('❌ Quran Command Error:', error);
        
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        await socket.sendMessage(from, {
            text: `⚠️ *Unable to fetch Quran verse*\n\n` +
                  `• Please check Surah and Ayah numbers\n` +
                  `• Make sure format is correct (e.g., 2:255)\n` +
                  `• Try again with a valid verse\n\n` +
                  `*Example:* ${config.PREFIX}quran 1:1`
        }, { quoted: fakevCard });
    }
    break;
}
//bible case 
case 'bible': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📖",
            key: msg.key
        }
    });

    const axios = require("axios");

    try {
        // Extract query from message
        const q = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || '';
        
        const args = q.split(' ').slice(1);
        const reference = args.join(' ').trim();

        if (!reference) {
            return await socket.sendMessage(sender, {
                text: `⚠️ *Please provide a Bible reference.*\n\n📝 *Example:*\n.bible John 1:1`
            }, { quoted: msg });
        }

        const apiUrl = `https://bible-api.com/${encodeURIComponent(reference)}`;
        const response = await axios.get(apiUrl, { timeout: 10000 });

        if (response.status === 200 && response.data.text) {
            const { reference: ref, text, translation_name } = response.data;
            const status = `📜 *Bible Verse Found!*\n\n` +
                         `📖 *Reference:* ${ref}\n` +
                         `📚 *Text:* ${text}\n\n` +
                         `🗂️ *Translation:* ${translation_name}\n\n` +
                         `> © CASEYRHODES XMD BIBLE`;

            await socket.sendMessage(sender, { 
                image: { url: `https://files.catbox.moe/y3j3kl.jpg` },
                caption: status,
                footer: "Choose an option below",
                buttons: [
                    { buttonId: '.allmenu', buttonText: { displayText: '🎀ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                    { buttonId: '.bible', buttonText: { displayText: '🔍 sᴇᴀʀᴄʜ ᴀɴᴏᴛʜᴇʀ' }, type: 1 }
                ],
                contextInfo: {
                    mentionedJid: [sender],
                    forwardingScore: 999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259 newsletter',
                        newsletterName: 'CASEYRHODES BIBLE 🎉🙏',
                        serverMessageId: 143
                    }
                }
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: msg });
        }
    } catch (error) {
        console.error('Bible Error:', error);
        
        if (error.response?.status === 404) {
            await socket.sendMessage(sender, {
                text: "❌ *Verse not found.* Please check the reference and try again."
            }, { quoted: msg });
        } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            await socket.sendMessage(sender, {
                text: "⏰ *Request timeout.* Please try again later."
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, {
                text: "⚠️ *An error occurred while fetching the Bible verse.* Please try again."
            }, { quoted: msg });
        }
    }
    break;
}
// Case: compliment / comp / praise - Send a random compliment
case 'compliment':
case 'comp':
case 'praise': {
    try {
        const COMPLIMENTS = [
            "ʏᴏᴜ ᴍᴀᴋᴇ ᴛʜᴇ ᴡᴏʀʟᴅ ᴀ ʙᴇᴛᴛᴇʀ ᴘʟᴀᴄᴇ ᴊᴜsᴛ ʙʏ ʙᴇɪɴɢ ɪɴ ɪᴛ. 🌟",
            "ʏᴏᴜʀ sᴍɪʟᴇ ᴄᴏᴜʟᴅ ʟɪɢʜᴛ ᴜᴘ ᴛʜᴇ ᴅᴀʀᴋᴇsᴛ ʀᴏᴏᴍ. ✨",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀɴ ɪɴᴄʀᴇᴅɪʙʟᴇ ᴀʙɪʟɪᴛʏ ᴛᴏ ᴍᴀᴋᴇ ᴇᴠᴇʀʏᴏɴᴇ ғᴇᴇʟ ᴡᴇʟᴄᴏᴍᴇ.",
            "ʏᴏᴜʀ ᴋɪɴᴅɴᴇss ɪs ᴀ ʀᴀʀᴇ ᴀɴᴅ ʙᴇᴀᴜᴛɪғᴜʟ ɢɪғᴛ ᴛᴏ ᴛʜᴇ ᴡᴏʀʟᴅ. 🎁",
            "ʏᴏᴜ ᴀʀᴇ ᴍᴏʀᴇ ʀᴇsɪʟɪᴇɴᴛ ᴛʜᴀɴ ʏᴏᴜ ɢɪᴠᴇ ʏᴏᴜʀsᴇʟғ ᴄʀᴇᴅɪᴛ ғᴏʀ. 💪",
            "ᴛʜᴇ ᴡᴀʏ ʏᴏᴜ ᴄᴀʀʀʏ ʏᴏᴜʀsᴇʟғ ɪɴsᴘɪʀᴇs ᴘᴇᴏᴘʟᴇ ᴀʀᴏᴜɴᴅ ʏᴏᴜ.",
            "ʏᴏᴜʀ ᴄʀᴇᴀᴛɪᴠɪᴛʏ ɪs ɢᴇɴᴜɪɴᴇʟʏ ɪᴍᴘʀᴇssɪᴠᴇ. 🎨",
            "ʏᴏᴜ ʜᴀɴᴅʟᴇ ᴄʜᴀʟʟᴇɴɢᴇs ᴡɪᴛʜ sᴜᴄʜ ɢʀᴀᴄᴇ ᴀɴᴅ sᴛʀᴇɴɢᴛʜ.",
            "ᴘᴇᴏᴘʟᴇ ᴀʀᴇ ʟᴜᴄᴋʏ ᴛᴏ ʜᴀᴠᴇ ʏᴏᴜ ɪɴ ᴛʜᴇɪʀ ʟɪᴠᴇs. 🍀",
            "ʏᴏᴜʀ sᴇɴsᴇ ᴏғ ʜᴜᴍᴏʀ ʙʀɪɴɢs sᴏ ᴍᴜᴄʜ ᴊᴏʏ ᴛᴏ ᴏᴛʜᴇʀs. 😄",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀ ʜᴇᴀʀᴛ ᴏғ ɢᴏʟᴅ. 💛",
            "ʏᴏᴜ'ʀᴇ ᴅᴏɪɴɢ ʙᴇᴛᴛᴇʀ ᴛʜᴀɴ ʏᴏᴜ ᴛʜɪɴᴋ. ᴋᴇᴇᴘ ɢᴏɪɴɢ!",
            "ʏᴏᴜʀ ɪɴᴛᴇʟʟɪɢᴇɴᴄᴇ ᴀɴᴅ ᴛʜᴏᴜɢʜᴛғᴜʟɴᴇss ᴀʀᴇ ᴛʀᴜʟʏ ʀᴇᴍᴀʀᴋᴀʙʟᴇ.",
            "ʏᴏᴜ ᴍᴀᴋᴇ ʜᴀʀᴅ ᴛʜɪɴɢs ʟᴏᴏᴋ ᴇᴀsʏ — ᴛʜᴀᴛ's ᴀ ʀᴇᴀʟ ᴛᴀʟᴇɴᴛ.",
            "ʙᴇɪɴɢ ᴀʀᴏᴜɴᴅ ʏᴏᴜ ғᴇᴇʟs ʟɪᴋᴇ ᴀ ʙʀᴇᴀᴛʜ ᴏғ ғʀᴇsʜ ᴀɪʀ. 🌬️",
            "ʏᴏᴜ ʙʀɪɴɢ ᴏᴜᴛ ᴛʜᴇ ʙᴇsᴛ ɪɴ ᴛʜᴇ ᴘᴇᴏᴘʟᴇ ᴀʀᴏᴜɴᴅ ʏᴏᴜ. 🌸",
            "ʏᴏᴜʀ ᴅᴇᴅɪᴄᴀᴛɪᴏɴ ᴀɴᴅ ᴡᴏʀᴋ ᴇᴛʜɪᴄ ᴀʀᴇ ᴛʀᴜʟʏ ᴀᴅᴍɪʀᴀʙʟᴇ. 🏆",
            "ʏᴏᴜ ʜᴀᴠᴇ ᴀ ʙᴇᴀᴜᴛɪғᴜʟ ᴍɪɴᴅ ᴀɴᴅ ᴀɴ ᴇᴠᴇɴ ᴍᴏʀᴇ ʙᴇᴀᴜᴛɪғᴜʟ sᴏᴜʟ.",
            "ᴛʜᴇ ᴡᴏʀʟᴅ ɪs ɢᴇɴᴜɪɴᴇʟʏ ʙᴇᴛᴛᴇʀ ᴡɪᴛʜ ʏᴏᴜ ɪɴ ɪᴛ. 🌍",
            "ʏᴏᴜ ᴀʀᴇ ᴇxᴀᴄᴛʟʏ ᴡʜᴏ ʏᴏᴜ ɴᴇᴇᴅ ᴛᴏ ʙᴇ. 🔥",
        ];

        await socket.sendMessage(sender, { react: { text: '💐', key: msg.key } });

        const pick = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        
        const target = mentioned.length
            ? `@${mentioned[0].split('@')[0]}, ${pick.charAt(0).toLowerCase() + pick.slice(1)}`
            : pick;

        await socket.sendMessage(sender, {
            text: `💐 *ᴄᴏᴍᴘʟɪᴍᴇɴᴛ*\n\n${target}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}comp`, buttonText: { displayText: '💐 ᴀɴᴏᴛʜᴇʀ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Compliment] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//delete case 
case 'delete':
case 'del':
case 'd': {
    try {
        // Check if the message is a reply
        if (!msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please reply to a message to delete it!*'
            }, { quoted: msg });
        }

        const quoted = msg.message.extendedTextMessage.contextInfo;
        const isGroup = sender.endsWith('@g.us');
        
        // For groups - check if user is admin
        if (isGroup) {
            try {
                const groupMetadata = await socket.groupMetadata(sender);
                const participant = msg.key.participant || msg.key.remoteJid;
                const isAdmins = groupMetadata.participants.find(p => p.id === participant)?.admin;
                const isOwner = groupMetadata.owner === participant;
                
                if (!isAdmins && !isOwner) {
                    return await socket.sendMessage(sender, {
                        text: '❌ *You need admin rights to delete messages in groups!*'
                    }, { quoted: msg });
                }
            } catch (groupError) {
                console.error('Group metadata error:', groupError);
            }
        }

        // Delete the quoted message
        const deleteParams = {
            remoteJid: sender,
            id: quoted.stanzaId,
            participant: quoted.participant,
            fromMe: quoted.participant === (msg.key.participant || msg.key.remoteJid)
        };

        await socket.sendMessage(sender, { delete: deleteParams });

        // Send success message with button instead of deleting command
        const successMessage = {
            text: '✅ *Message deleted successfully!*',
            buttons: [
                {
                    buttonId: '.delete',
                    buttonText: { displayText: '🗑️ Delete Another' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🎌Help' },
                    type: 1
                }
            ],
            footer: 'Powered by CASEYRHODES XTECH',
            headerType: 1
        };

        await socket.sendMessage(sender, successMessage, { quoted: msg });

    } catch (error) {
        console.error('Delete error:', error);
        
        // Send error message with button
        const errorMessage = {
            text: `❌ *Failed to delete message!*\n${error.message || 'Unknown error'}`,
            buttons: [
                {
                    buttonId: '.almenu',
                    buttonText: { displayText: '❓ Get Help' },
                    type: 1
                },
                {
                    buttonId: '.owner',
                    buttonText: { displayText: '🆘 Support' },
                    type: 1
                }
            ],
            footer: 'Powered by caseyrhodes 🌸',
            headerType: 1
        };
        
        await socket.sendMessage(sender, errorMessage, { quoted: msg });
    }
    break;
}
//jid case
// Case: time / clock / timezone - Get current time in any city
case 'time':
case 'clock':
case 'timezone': {
    try {
        const ZONES = {
            nairobi:'Africa/Nairobi', kenya:'Africa/Nairobi', lagos:'Africa/Lagos',
            cairo:'Africa/Cairo', london:'Europe/London', paris:'Europe/Paris',
            berlin:'Europe/Berlin', dubai:'Asia/Dubai', india:'Asia/Kolkata',
            delhi:'Asia/Kolkata', tokyo:'Asia/Tokyo', japan:'Asia/Tokyo',
            beijing:'Asia/Shanghai', china:'Asia/Shanghai', 'new york':'America/New_York',
            newyork:'America/New_York', losangeles:'America/Los_Angeles',
            sydney:'Australia/Sydney', australia:'Australia/Sydney',
            brazil:'America/Sao_Paulo', moscow:'Europe/Moscow'
        };

        const input = args.join(' ').toLowerCase().trim();
        
        if (!input) {
            await socket.sendMessage(sender, {
                text: `🕐 *ᴡᴏʀʟᴅ ᴄʟᴏᴄᴋ*\n\nɢᴇᴛ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴛɪᴍᴇ ɪɴ ᴀɴʏ ᴄɪᴛʏ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}time <city>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}time Nairobi\`\n• \`${prefix}time London\`\n• \`${prefix}time Tokyo\`\n• \`${prefix}time New York\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}time Nairobi`, buttonText: { displayText: '🇰🇪 ɴᴀɪʀᴏʙɪ' }, type: 1 },
                    { buttonId: `${prefix}time London`, buttonText: { displayText: '🇬🇧 ʟᴏɴᴅᴏɴ' }, type: 1 },
                    { buttonId: `${prefix}time Tokyo`, buttonText: { displayText: '🇯🇵 ᴛᴏᴋʏᴏ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🕐', key: msg.key } });

        const tz = ZONES[input] || ZONES[input.replace(/\s+/g, '')] || args.join('/');
        const place = args.join(' ');

        const now = new Date().toLocaleString('en-US', {
            timeZone: tz,
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
        });

        await socket.sendMessage(sender, {
            text: `🕐 *ᴛɪᴍᴇ ɪɴ ${place.toUpperCase()}*\n\n${now}\n🌍 ᴛɪᴍᴇᴢᴏɴᴇ: \`${tz}\`\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}time`, buttonText: { displayText: '🕐 ᴄʜᴇᴄᴋ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch {
        await socket.sendMessage(sender, {
            text: `❌ *ᴜɴᴋɴᴏᴡɴ ᴛɪᴍᴇᴢᴏɴᴇ*\n\n"${args.join(' ')}" ɴᴏᴛ ғᴏᴜɴᴅ.\n\n*ᴛʀʏ:* Nairobi, London, Tokyo, New York, Dubai, Sydney, Paris, Berlin`,
            buttons: [
                { buttonId: `${prefix}time Nairobi`, buttonText: { displayText: '🇰🇪 ɴᴀɪʀᴏʙɪ' }, type: 1 },
                { buttonId: `${prefix}time London`, buttonText: { displayText: '🇬🇧 ʟᴏɴᴅᴏɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Case: calc / calculate / math - Evaluate a math expression
case 'calc':
case 'calculate':
case 'math': {
    try {
        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `🧮 *ᴄᴀʟᴄᴜʟᴀᴛᴏʀ*\n\nᴇᴠᴀʟᴜᴀᴛᴇ ᴀ ᴍᴀᴛʜ ᴇxᴘʀᴇssɪᴏɴ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}calc <expression>\`\n\n*ᴇxᴀᴍᴘʟᴇs:*\n• \`${prefix}calc 25 * 4\`\n• \`${prefix}calc (100 + 50) / 3\`\n• \`${prefix}calc 2 ** 10\`\n• \`${prefix}calc Math.sqrt(144)\`\n\n> ${config.BOT_FOOTER}`,
                buttons: [
                    { buttonId: `${prefix}calc 25 * 4`, buttonText: { displayText: '25 × 4' }, type: 1 },
                    { buttonId: `${prefix}calc Math.sqrt(144)`, buttonText: { displayText: '√144' }, type: 1 },
                    { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
                ],
                headerType: 1
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🧮', key: msg.key } });

        // Sanitize input: allow digits, operators, parentheses, dot, common Math functions, spaces
        const expr = args.join(' ')
            .replace(/[^0-9+\-*/().%, \tMathsqrtpowabsceilflooroundrndmlogIE]/g, '')
            .trim();

        if (!expr) {
            await socket.sendMessage(sender, {
                text: `❌ *ɪɴᴠᴀʟɪᴅ ᴇxᴘʀᴇssɪᴏɴ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ᴍᴀᴛʜ ᴇxᴘʀᴇssɪᴏɴ.`,
                quoted: msg
            });
            break;
        }

        const result = Function('"use strict"; return (' + expr + ')')();

        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Invalid result');
        }

        await socket.sendMessage(sender, {
            text: `🧮 *ᴄᴀʟᴄᴜʟᴀᴛᴏʀ*\n\n📥 *ɪɴᴘᴜᴛ:* \`${args.join(' ')}\`\n📤 *ʀᴇsᴜʟᴛ:* \`${result.toLocaleString()}\`\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}calc`, buttonText: { displayText: '🧮 ᴄᴀʟᴄᴜʟᴀᴛᴇ ᴀɢᴀɪɴ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Calc] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ɪɴᴠᴀʟɪᴅ ᴇxᴘʀᴇssɪᴏɴ*\n\n\`${args.join(' ')}\`\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
case 'jid': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "📍",
            key: msg.key
        }
    });

    try {
        // Check if it's a group and user has permission
        // You'll need to implement your own permission logic
        const isGroup = msg.key.remoteJid.endsWith('@g.us');
        const isOwner = true; // Replace with your actual owner check logic
        const isAdmin = true; // Replace with your actual admin check logic

        // Permission check - only owner in private chats or admin/owner in groups
        if (!isGroup && !isOwner) {
            return await socket.sendMessage(sender, {
                text: "⚠️ Only the bot owner can use this command in private chats."
            }, { quoted: msg });
        }

        if (isGroup && !isOwner && !isAdmin) {
            return await socket.sendMessage(sender, {
                text: "⚠️ Only group admins or bot owner can use this command."
            }, { quoted: msg });
        }

        // Newsletter message configuration
        const newsletterConfig = {
            mentionedJid: [sender],
            forwardingScore: 999,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420261263259@newsletter',
                newsletterName: '𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐓𝐄𝐂𝐇',
                serverMessageId: 143
            }
        };

        // Prepare the appropriate response
        let response;
        if (isGroup) {
            response = `🔍 *Group JID*\n${msg.key.remoteJid}`;
        } else {
            response = `👤 *Your JID*\n${sender.split('@')[0]}@s.whatsapp.net`;
        }

        // Send the newsletter-style message with button
        await socket.sendMessage(sender, {
            text: response,
            footer: "Need help? Contact owner",
            buttons: [
                { buttonId: '.owner', buttonText: { displayText: '👑 CONTACT OWNER' }, type: 1 }
            ],
            contextInfo: newsletterConfig
        }, { quoted: msg });

    } catch (e) {
        console.error("JID Error:", e);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred: ${e.message || e}`
        }, { quoted: msg });
    }
    break;
}
//vcf case
//===============================
// 12
                case 'bomb': {
                    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '📌 *Usage:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 263XXXXXXX,Hello 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '❌ *Easy, tiger! Max 20 messages per bomb, okay? 😘*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `✅ Bomb sent to ${target} — ${count}x, love! 💣😉`
                    }, { quoted: fakevCard });
                    break;
                }
//===============================
// 13
                
// ┏━━━━━━━━━━━━━━━❖
// ┃ FUN & ENTERTAINMENT COMMANDS
// ┗━━━━━━━━━━━━━━━❖
case 'joke': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 15000 });
        if (!data?.setup || !data?.punchline) {
            throw new Error('Failed to fetch joke');
        }

        const caption = `
╭━━〔 *ʀᴀɴᴅᴏᴍ ᴊᴏᴋᴇ* 〕━━┈⊷
├ *sᴇᴛᴜᴘ*: ${data.setup} 🤡
├ *ᴘᴜɴᴄʜʟɪɴᴇ*: ${data.punchline} 😂
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Joke error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch joke* 😞'
        }, { quoted: msg });
    }
    break;
}


case "waifu": {
    try {
        await socket.sendMessage(sender, { react: { text: '🥲', key: msg.key } });
        const res = await fetch('https://api.waifu.pics/sfw/waifu');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch waifu image.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: '✨ Here\'s your random waifu!'
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to get waifu.' }, { quoted: fakevCard });
    }
    break;
}

case "meme": {
    try {
        await socket.sendMessage(sender, { react: { text: '😂', key: msg.key } });
        const res = await fetch('https://meme-api.com/gimme');
        const data = await res.json();
        if (!data || !data.url) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch meme.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.url },
            caption: `🤣 *${data.title}*`
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch meme.' }, { quoted: fakevCard });
    }
    break;
}
case 'readmore':
case 'rm':
case 'rmore':
case 'readm': {
    try {
        // Extract text from message
        const q = msg.message?.conversation || '';
        const args = q.split(' ').slice(1);
        const inputText = args.join(' ') || 'No text provided';

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const readMore = String.fromCharCode(8206).repeat(4000);
        const message = `${inputText}${readMore} *Continue Reading...*`;

        const caption = `
╭───[ *ʀᴇᴀᴅ ᴍᴏʀᴇ* ]───
├ *ᴛᴇxᴛ*: ${message} 📝
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Readmore error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: `❌ *Error creating read more:* ${error.message || 'unknown error'}`
        }, { quoted: msg });
    }
    break;
}
//case cat
case "cats": {
    try {
        await socket.sendMessage(sender, { react: { text: '🐱', key: msg.key } });
        const res = await fetch('https://api.thecatapi.com/v1/images/search');
        const data = await res.json();
        if (!data || !data[0]?.url) {
            await socket.sendMessage(sender, { 
                text: '❌ Couldn\'t fetch cat image.' 
            }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data[0].url },
            caption: '🐱 Meow~ Here\'s a cute cat for you!',
            buttons: [
                { buttonId: '.cat', buttonText: { displayText: '🐱 Another Cat' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { 
            text: '❌ Failed to fetch cat image.',
            buttons: [
                { buttonId: '.cat', buttonText: { displayText: '🔄 Try Again' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}
//case dog 
case "dog": {
    try {
        await socket.sendMessage(sender, { react: { text: '🦮', key: msg.key } });
        const res = await fetch('https://dog.ceo/api/breeds/image/random');
        const data = await res.json();
        if (!data || !data.message) {
            await socket.sendMessage(sender, { 
                text: '❌ Couldn\'t fetch dog image.' 
            }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, {
            image: { url: data.message },
            caption: '🐶 Woof! Here\'s a cute dog!',
            buttons: [
                { buttonId: '.dog', buttonText: { displayText: '🐶 Another Dog' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { 
            text: '❌ Failed to fetch dog image.',
            buttons: [
                { buttonId: '.dog', buttonText: { displayText: '🔄 Try Again' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }
    break;
}

case 'fact': {
    try {
        const axios = require('axios');
        
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const { data } = await axios.get('https://uselessfacts.jsph.pl/random.json?language=en', { timeout: 15000 });
        if (!data?.text) throw new Error('Failed to fetch fact');

        const caption = `
╭───[ *ʀᴀɴᴅᴏᴍ ғᴀᴄᴛ* ]───
├ *ғᴀᴄᴛ*: ${data.text} 🧠
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Fact error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch fun fact* 😞'
        }, { quoted: msg });
    }
    break;
}
case 'flirt':
case 'masom':
case 'line': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/flirt?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ғʟɪʀᴛ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${result} 💘
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Flirt error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch flirt line* 😞'
        }, { quoted: msg });
    }
    break;
}

case "darkjoke": case "darkhumor": {
    try {
        await socket.sendMessage(sender, { react: { text: '😬', key: msg.key } });
        const res = await fetch('https://v2.jokeapi.dev/joke/Dark?type=single');
        const data = await res.json();
        if (!data || !data.joke) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch a dark joke.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🌚 *Dark Humor:*\n\n${data.joke}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch dark joke.' }, { quoted: fakevCard });
    }
    break;
}

case 'truth':
case 'truthquestion': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/truth?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴛʀᴜᴛʜ ǫᴜᴇsᴛɪᴏɴ* ]───
├ *ǫᴜᴇsᴛɪᴏɴ*: ${result} ❓
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Truth error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch truth question* 😞'
        }, { quoted: msg });
    }
    break;
}
// ┏━━━━━━━━━━━━━━━❖
// ┃ INSULT
// ┗━━━━━━━━━━━━━━━❖
case 'insult': {
    try {
        const insults = [
            "You're like a cloud. When you disappear, it's a beautiful day!",
            "You bring everyone so much joy when you leave the room!",
            "I'd agree with you, but then we'd both be wrong.",
            "You're not stupid; you just have bad luck thinking.",
            "Your secrets are always safe with me. I never even listen to them.",
            "You're proof that even evolution takes a break sometimes.",
            "You have something on your chin... no, the third one down.",
            "You're like a software update. Whenever I see you, I think, 'Do I really need this right now?'",
            "You bring everyone happiness... you know, when you leave.",
            "You're like a penny—two-faced and not worth much.",
            "You have something on your mind... oh wait, never mind.",
            "You're the reason they put directions on shampoo bottles.",
            "You're like a cloud. Always floating around with no real purpose.",
            "Your jokes are like expired milk—sour and hard to digest.",
            "You're like a candle in the wind... useless when things get tough.",
            "You have something unique—your ability to annoy everyone equally.",
            "You're like a Wi-Fi signal—always weak when needed most.",
            "You're proof that not everyone needs a filter to be unappealing.",
            "Your energy is like a black hole—it just sucks the life out of the room.",
            "You have the perfect face for radio.",
            "You're like a traffic jam—nobody wants you, but here you are.",
            "You're like a broken pencil—pointless.",
            "Your ideas are so original, I'm sure I've heard them all before.",
            "You're living proof that even mistakes can be productive.",
            "You're not lazy; you're just highly motivated to do nothing.",
            "Your brain's running Windows 95—slow and outdated.",
            "You're like a speed bump—nobody likes you, but everyone has to deal with you.",
            "You're like a cloud of mosquitoes—just irritating.",
            "You bring people together... to talk about how annoying you are."
        ];

        // React to the command first
        await socket.sendMessage(sender, {
            react: {
                text: "💀",
                key: msg.key
            }
        });

        let userToInsult;
        
        // Check for mentioned users
        if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            userToInsult = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        }
        // Check for replied message
        else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
            userToInsult = msg.message.extendedTextMessage.contextInfo.participant;
        }
        
        if (!userToInsult) {
            return await socket.sendMessage(sender, { 
                text: '*💀 Insult Command*\nPlease mention someone or reply to their message to insult them!\n\nExample: .insult @user*'
            }, { quoted: msg });
        }

        // Don't let users insult themselves
        if (userToInsult === sender) {
            return await socket.sendMessage(sender, { 
                text: "*🤨 Self-Insult Blocked*\nYou can't insult yourself! That's just sad...*"
            }, { quoted: msg });
        }

        // Don't let users insult the bot
        if (userToInsult.includes('bot') || userToInsult.includes('Bot')) {
            return await socket.sendMessage(sender, { 
                text: "*🤖 Nice Try*\nYou can't insult me! I'm just a bunch of code.*"
            }, { quoted: msg });
        }

        const insult = insults[Math.floor(Math.random() * insults.length)];
        const username = userToInsult.split('@')[0];

        console.log(`[INSULT] ${sender} insulting ${userToInsult}`);

        // Add small delay for dramatic effect
        await new Promise(resolve => setTimeout(resolve, 1500));

        await socket.sendMessage(sender, { 
            text: `🎯 *Target:* @${username}\n💀 *Insult:* ${insult}\n\n*Disclaimer: This is all in good fun! 😄*`,
            mentions: [userToInsult]
        }, { quoted: msg });

        // React with success
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('[INSULT] Error:', error.message);
        
        if (error.message.includes('429') || error.data === 429) {
            await socket.sendMessage(sender, { 
                text: '*⏰ Rate Limited*\nPlease try again in a few seconds.*'
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { 
                text: '*❌ Insult Failed*\nAn error occurred while sending the insult. Please try again later.*'
            }, { quoted: msg });
        }
    }
    break;
}
// ┏━━━━━━━━━━━━━━━❖
// ┃ ROMANTIC, SAVAGE & THINKY COMMANDS
// ┗━━━━━━━━━━━━━━━❖

case 'pickupline':
case 'pickup': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://api.popcat.xyz/pickuplines', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { pickupline } = await res.json();
        if (!pickupline) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴘɪᴄᴋᴜᴘ ʟɪɴᴇ* ]───
├ *ʟɪɴᴇ*: ${pickupline} 💬
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Pickupline error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch pickup line* 😞'
        }, { quoted: msg });
    }
    break;
}

case "roast": {
    try {
        await socket.sendMessage(sender, { react: { text: '🤬', key: msg.key } });
        const res = await fetch('https://vinuxd.vercel.app/api/roast');
        const data = await res.json();
        if (!data || !data.data) {
            await socket.sendMessage(sender, { text: '❌ No roast available at the moment.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `🔥 *Roast:* ${data.data}` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch roast.' }, { quoted: fakevCard });
    }
    break;
}

case "lovequote": {
    try {
        await socket.sendMessage(sender, { react: { text: '🙈', key: msg.key } });
        const res = await fetch('https://api.popcat.xyz/lovequote');
        const data = await res.json();
        if (!data || !data.quote) {
            await socket.sendMessage(sender, { text: '❌ Couldn\'t fetch love quote.' }, { quoted: fakevCard });
            break;
        }
        await socket.sendMessage(sender, { text: `❤️ *Love Quote:*\n\n"${data.quote}"` }, { quoted: fakevCard });
    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch love quote.' }, { quoted: fakevCard });
    }
    break;
}
case 'dare':
case 'truthordare': {
    try {
        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        const res = await fetch('https://shizoapi.onrender.com/api/texts/dare?apikey=shizo', { timeout: 15000 });
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        const { result } = await res.json();
        if (!result) throw new Error('Invalid API response');

        const caption = `
╭───[ *ᴅᴀʀᴇ ᴄʜᴀʟʟᴇɴɢᴇ* ]───
├ *ᴅᴀʀᴇ*: ${result} 🎯
╰──────────────┈⊷
> *ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ*`;

        await socket.sendMessage(sender, { 
            text: caption,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid]
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('Dare error:', error);
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        await socket.sendMessage(sender, {
            text: error.message.includes('timeout') ? 
                '❌ *Request timed out* ⏰' : 
                '❌ *Failed to fetch dare* 😞'
        }, { quoted: msg });
    }
    break;
}

//===============================
// Case: facebook / fb / fbdl - Download Facebook video
case 'facebook':
case 'fb':
case 'fbdl': {
    try {
        const url = args[0];
        
        if (!url) {
            await socket.sendMessage(sender, {
                text: `📘 *ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ*\n\nᴅᴏᴡɴʟᴏᴀᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏs.\n\n*ᴜsᴀɢᴇ:* \`${prefix}fb <url>\`\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}fb https://www.facebook.com/...\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        const urlRegex = /^(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.watch|m\.facebook\.com)\b/i;
        if (!urlRegex.test(url)) {
            await socket.sendMessage(sender, {
                text: `⚠️ *ɪɴᴠᴀʟɪᴅ ᴜʀʟ*\n\nᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀ ᴠᴀʟɪᴅ ғᴀᴄᴇʙᴏᴏᴋ ᴜʀʟ.\n\n*ᴇxᴀᴍᴘʟᴇ:*\n\`${prefix}fb https://www.facebook.com/...\``,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📘', key: msg.key } });

        const downloadingMsg = await socket.sendMessage(sender, {
            text: '📥 *ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ...*',
            quoted: msg
        });

        const apiUrl = `https://api.nexoracle.com/downloaders/fbdl?url=${encodeURIComponent(url)}&apikey=free_for_use`;
        const { data } = await axios.get(apiUrl, {
            timeout: 30000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const videoUrl = data?.result?.hd || data?.result?.sd || data?.link;
        if (!videoUrl) throw new Error('Could not extract video URL. The link may be private or unsupported.');

        const title = data?.result?.title || 'Facebook Video';

        // Delete downloading message
        try { await socket.sendMessage(sender, { delete: downloadingMsg.key }); } catch {}

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: `📘 *ғᴀᴄᴇʙᴏᴏᴋ ᴠɪᴅᴇᴏ*\n\n📌 *ᴛɪᴛʟᴇ:* ${title}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}fb`, buttonText: { displayText: '📘 ᴅᴏᴡɴʟᴏᴀᴅ ᴀɢᴀɪɴ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1,
            contextInfo: {
                externalAdReply: {
                    title: 'ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅᴇʀ',
                    body: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ' + config.OWNER_NAME,
                    thumbnailUrl: config.RCD_IMAGE_PATH,
                    sourceUrl: url,
                    mediaType: 1,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
        console.error('[Facebook] Error:', err.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀᴄᴇʙᴏᴏᴋ ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ*\n\n${err.message}\n\n*ᴛɪᴘs:*\n• ᴇɴsᴜʀᴇ ᴛʜᴇ ᴠɪᴅᴇᴏ ɪs ᴘᴜʙʟɪᴄ\n• ᴛʀʏ ᴀ ᴅɪғғᴇʀᴇɴᴛ ʟɪɴᴋ`,
            buttons: [
                { buttonId: `${prefix}fb`, buttonText: { displayText: '🔄 ʀᴇᴛʀʏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
//===============================
                case 'nasa': {
                    try {
                    await socket.sendMessage(sender, { react: { text: '✔️', key: msg.key } });
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '🌌 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ ɴᴀsᴀ ɴᴇᴡs',
                                `🌠 *${title}*\n\n${explanation.substring(0, 200)}...\n\n📆 *Date*: ${date}\n${copyright ? `📝 *Credit*: ${copyright}` : ''}\n🔗 *Link*: https://apod.nasa.gov/apod/astropix.html`,
                                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, love, the stars didn’t align this time! 🌌 Try again? 😘'
                        });
                    }
                    break;
                }
//===============================
                case 'news': {
                await socket.sendMessage(sender, { react: { text: '😒', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  '
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, sweetie, the news got lost in the wind! 😢 Try again?'
                        });
                    }
                    break;
                }
//===============================                
// 17
                case 'cricket': {
                await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
                        }

                        console.log('Sending message to user...');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🏏 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ  CRICKET NEWS🏏',
                                `📢 *${title}*\n\n` +
                                `🏆 *Mark*: ${score}\n` +
                                `🎯 *To Win*: ${to_win}\n` +
                                `📈 *Current Rate*: ${crr}\n\n` +
                                `🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                        console.log('Message sent successfully.');
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the cricket ball flew away! 🏏 Try again? 😘'
                        });
                    }
                    break;
                }

//===============================
                case 'ig': {
                await socket.sendMessage(sender, { react: { text: '✅️', key: msg.key } });
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper'); 
                        

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim(); 
                    
                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '🧩 *Give me a real Instagram video link, darling 😘*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '> mᥲძᥱ ᑲᥡ ᴄᴀsᴇʏʀʜᴏᴅᴇs'
                            }, { quoted: fakevCard });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ No video found in that link, love! Try another? 💔*' });
                        }
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ Oh, sweetie, that Instagram video got away! 😢*' });
                    }
                    break;
                }
//===============================     
               case 'active': {
    await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
    
    try {
        const activeCount = activeSockets.size;
        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

        // Using URL directly (if your library supports it)
        await socket.sendMessage(from, {
            text: `👥 Active Members: *${activeCount}*\n\nNumbers:\n${activeNumbers}`,
            contextInfo: {
                externalAdReply: {
                    title: 'Powered by CaseyRhodes Tech 👻',
                    body: 'Active Members Report',
                    mediaType: 1,
                    sourceUrl: 'https://wa.me/1234567890',
                    thumbnailUrl: 'https://files.catbox.moe/k3wgqy.jpg'
                }
            }
        }, { quoted: msg });

    } catch (error) {
        console.error('Error in .active command:', error);
        await socket.sendMessage(from, { text: '❌ Oh, darling, I couldn\'t count the active souls! 💔 Try again?' }, { quoted: fakevCard });
    }
    break;
}
                //===============================
// 22
case 'ai':
case 'ask':
case 'gpt':
case 'casey': {
    try {
        const axios = require("axios");
        
        // Send processing reaction
        await socket.sendMessage(sender, { 
            react: { 
                text: '🤖', 
                key: msg.key 
            } 
        });

        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';

        if (!q || q.trim() === '') {
            return await socket.sendMessage(from, {
                text: `❓ *Please ask me something*\n\n*Example:* ${config.PREFIX}ai Who are you?`,
                buttons: [
                    {
                        buttonId: `${config.PREFIX}ai Who are you?`,
                        buttonText: { displayText: '👋 WHO ARE YOU' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}ai What can you do?`,
                        buttonText: { displayText: '🤖 WHAT CAN YOU DO' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        // Function to handle custom responses
        const getCustomResponse = (text) => {
            const lowerText = text.toLowerCase();
            
            // Check for owner/developer related queries
            if (lowerText.includes('owner') || lowerText.includes('developer') || lowerText.includes('creator') || 
                lowerText.includes('who owns you') || lowerText.includes('who created you') || 
                lowerText.includes('who developed you') || lowerText.includes('who built you')) {
                
                return {
                    text: `*👨‍💻 MEET THE DEVELOPER*\n\n🇰🇪 *Primary Developer:* CaseyRhodes Tech\n• Location: Kenya\n• Specialization: AI Integration & Bot Development\n• Role: Lead Developer & Project Owner\n\n🤖 *Technical Partner:* Caseyrhodes\n• Specialization: Backend Systems & API Management\n• Role: Technical Support & Infrastructure\n\n*About Our Team:*\nCasey AI is the result of a CaseyRhodes Tech  Together, we bring you cutting-edge AI technology with reliable bot functionality, ensuring you get the best AI experience possible.\n\n*Proudly Made in Kenya* 🇰🇪`,
                    buttons: [
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '👑 CONTACT OWNER' },
                            type: 1
                        },
                        {
                            buttonId: `${config.PREFIX}repo`,
                            buttonText: { displayText: '🔮 REPOSITORY' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for creation date/when made queries
            if (lowerText.includes('when were you made') || lowerText.includes('when were you created') || 
                lowerText.includes('when were you developed') || lowerText.includes('creation date') || 
                lowerText.includes('when did you start') || lowerText.includes('how old are you') ||
                lowerText.includes('when were you built') || lowerText.includes('release date')) {
                
                return {
                    text: `*📅 CASEY AI TIMELINE*\n\n🚀 *Development Started:* December 2025\n🎯 *First Release:* January 2025\n🔄 *Current Version:* 2.0 (February 2025)\n\n*Development Journey:*\n• *Phase 1:* Core AI integration and basic functionality\n• *Phase 2:* Enhanced response system and multi-API support\n• *Phase 3:* Advanced customization and user experience improvements\n\n*What's Next:*\nWe're constantly working on updates to make Casey AI smarter, faster, and more helpful. Stay tuned for exciting new features!\n\n*Age:* Just a few months old, but getting smarter every day! 🧠✨`,
                    buttons: [
                        {
                            buttonId: `${config.PREFIX}ai What are your features?`,
                            buttonText: { displayText: '✨ FEATURES' },
                            type: 1
                        },
                        {
                            buttonId: `${config.PREFIX}menu`,
                            buttonText: { displayText: '📋 MAIN MENU' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for AI name queries
            if (lowerText.includes('what is your name') || lowerText.includes('what\'s your name') || 
                lowerText.includes('tell me your name') || lowerText.includes('your name') || 
                lowerText.includes('name?') || lowerText.includes('called?')) {
                
                return {
                    text: `*🏷️ MY NAME*\n\n👋 Hello! My name is *CASEY AI*\n\n*About My Name:*\n• Full Name: Casey AI\n• Short Name: Casey\n• You can call me: Casey, Casey AI, or just AI\n\n*Name Origin:*\nI'm named after my primary developer *CaseyRhodes Tech*, combining the personal touch of my creator with the intelligence of artificial intelligence technology.\n\n*What Casey Stands For:*\n🔹 *C* - Creative Problem Solving\n🔹 *A* - Advanced AI Technology\n🔹 *S* - Smart Assistance\n🔹 *E* - Efficient Responses\n🔹 *Y* - Your Reliable Companion\n\n*Made in Kenya* 🇰🇪 *by CaseyRhodes Tech*`,
                    buttons: [
                        {
                            buttonId: `${config.PREFIX}ai Who created you?`,
                            buttonText: { displayText: '👨‍💻 CREATOR' },
                            type: 1
                        },
                        {
                            buttonId: `${config.PREFIX}ai Tell me about yourself`,
                            buttonText: { displayText: '🤖 ABOUT ME' },
                            type: 1
                        }
                    ]
                };
            }

            // Check for general info about Casey AI
            if (lowerText.includes('what are you') || lowerText.includes('tell me about yourself') || 
                lowerText.includes('who are you') || lowerText.includes('about casey')) {
                
                return {
                    text: `👋 Hi! I'm *Casey AI*, your intelligent WhatsApp assistant developed by CaseyRhodes Tech.\n\n*What I Can Do:*\n• Answer questions on any topic\n• Help with problem-solving\n• Provide information and explanations\n• Assist with creative tasks\n• Engage in meaningful conversations\n\n*My Features:*\n✅ Advanced AI technology\n✅ Multi-language support\n✅ Fast response times\n✅ Reliable dual-API system\n✅ User-friendly interface\n\n*My Identity:*\n• Name: Casey AI\n• Origin: Kenya 🇰🇪\n• Purpose: Making AI accessible and helpful\n\n*Proudly Kenyan:* 🇰🇪\nBuilt with passion in Kenya, serving users worldwide with cutting-edge AI technology.\n\nHow can I assist you today?`,
                    buttons: [
                        {
                            buttonId: `${config.PREFIX}ai What can you help me with?`,
                            buttonText: { displayText: '💡 ʜᴇʟᴘ ᴛᴏᴘɪᴄ' },
                            type: 1
                        },
                        {
                            buttonId: `${config.PREFIX}menu`,
                            buttonText: { displayText: '📋 ᴍᴀɪɴ ᴍᴇɴᴜ' },
                            type: 1
                        },
                        {
                            buttonId: `${config.PREFIX}owner`,
                            buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' },
                            type: 1
                        }
                    ]
                };
            }

            // Return null if no custom response matches
            return null;
        };

        // Check for custom responses first
        const customResponse = getCustomResponse(q);
        if (customResponse) {
            return await socket.sendMessage(from, {
                image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
                caption: customResponse.text,
                buttons: customResponse.buttons,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363420261263259@newsletter',
                        newsletterName: 'CASEYRHODES XMD🌟',
                        serverMessageId: -1
                    }
                }
            }, { quoted: msg });
        }

        const apis = [
            `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(q)}`,
            `https://iamtkm.vercel.app/ai/gpt5?apikey=tkm&text=${encodeURIComponent(q)}`
        ];

        let response = null;
        for (const apiUrl of apis) {
            try {
                const res = await axios.get(apiUrl, { timeout: 10000 });
                response = res.data?.result || res.data?.response || res.data?.answer || res.data;
                if (response && typeof response === 'string' && response.trim() !== '') {
                    break;
                }
            } catch (err) {
                console.error(`AI Error (${apiUrl}):`, err.message);
                continue;
            }
        }

        if (!response) {
            return await socket.sendMessage(from, {
                text: `❌ *I'm experiencing technical difficulties*\nAll AI APIs are currently unavailable. Please try again later.`,
                buttons: [
                    {
                        buttonId: `${config.PREFIX}owner`,
                        buttonText: { displayText: '👑 REPORT ISSUE' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        // Send AI response with image and buttons
        await socket.sendMessage(from, {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: `🤖 *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ:*\n\n${response}\n\n👨‍💻 *ᴅᴇᴠᴇʟᴏᴘᴇʀ:* Caseyrhodes Tech`,
            buttons: [
                {
                    buttonId: `${config.PREFIX}ai`,
                    buttonText: { displayText: '🤖 ᴀsᴋ ᴀɢᴀɪɴ' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}menu`,
                    buttonText: { displayText: '📋ᴍᴀɪɴ ᴍᴇɴᴜ' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}owner`,
                    buttonText: { displayText: '👑 ᴏᴡɴᴇʀ' },
                    type: 1
                }
            ],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'CASEYRHODES XMD🌟',
                    serverMessageId: -1
                }
            }
        }, { quoted: msg });

        // Send success reaction
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

    } catch (error) {
        console.error('AI Command Error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(from, {
            text: `❌ *AI Error:* ${error.message}\nPlease try again later.`,
            buttons: [
                {
                    buttonId: `${config.PREFIX}owner`,
                    buttonText: { displayText: '👑 REPORT ISSUE' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}menu`,
                    buttonText: { displayText: '📋 MAIN MENU' },
                    type: 1
                }
            ]
        }, { quoted: msg });
    }
    break;
}
//===============================
case 'getpp':
case 'pp':
case 'profilepic': {
    await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
    try {
        let targetUser = sender;
        
        // Check if user mentioned someone or replied to a message
        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
        } else if (msg.quoted) {
            targetUser = msg.quoted.sender;
        }
        
        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
        
        if (ppUrl) {
            await socket.sendMessage(msg.key.remoteJid, {
                image: { url: ppUrl },
                caption: `Profile picture of @${targetUser.split('@')[0]}`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        } else {
            await socket.sendMessage(msg.key.remoteJid, {
                text: `@${targetUser.split('@')[0]} doesn't have a profile picture.`,
                mentions: [targetUser],
                buttons: [
                    { buttonId: '.menu', buttonText: { displayText: '🌸 Menu' }, type: 1 },
                    { buttonId: '.alive', buttonText: { displayText: '♻️ Status' }, type: 1 }
                ],
                footer: "ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴀɪ"
            });
        }
    } catch (error) {
        await socket.sendMessage(msg.key.remoteJid, {
            text: "Error fetching profile picture.",
            buttons: [
                { buttonId: 'menu', buttonText: { displayText: '📋 Menu' }, type: 1 }
            ]
        });
    }
    break;
}
//===============================
                  case 'aiimg': { 
                  await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    const axios = require('axios');
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: '🎨 *Give me a spicy prompt to create your AI image, darling 😘*'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '🧠 *Crafting your dreamy image, love...*',
                        });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '❌ *Oh no, the canvas is blank, babe 💔 Try again later.*'
                            });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `🧠 *ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ AI IMAGE*\n\n📌 Prompt: ${prompt}`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `❗ *Something broke my heart, love 😢*: ${err.response?.data?.message || err.message || 'Unknown error'}`
                        });
                    }
                    break;
                }
//===============================
                case 'gossip': {
                await socket.sendMessage(sender, { react: { text: '😅', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API From news Couldnt get it 😩');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API Received from news data a Problem with');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape Couldn't from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '📰 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ   GOSSIP Latest News් 📰',
                                `📢 *${title}*\n\n${desc}\n\n🕒 *Date*: ${date || 'Not yet given'}\n🌐 *Link*: ${link}`,
                                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '⚠️ Oh, darling, the gossip slipped away! 😢 Try again?'
                        });
                    }
                    break;
                }
                
                
 // New Commands: Group Management
 // Case: add - Add a member to the group
                case 'add': {
                await socket.sendMessage(sender, { react: { text: '➕️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, love!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can add members, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}add +254740007567\n\nExample: ${config.PREFIX}add +254740007567`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const numberToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await socket.groupParticipantsUpdate(from, [numberToAdd], 'add');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '✅ MEMBER ADDED',
                                `Successfully added ${args[0]} to the group! 🎉`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Add command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to add member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
/// case leave 
// Case: hidetag / htag / stag / silenttag - Silently mention all group members
case 'hidetag':
case 'htag':
case 'stag':
case 'silenttag': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴄᴀɴ ᴏɴʟʏ ʙᴇ ᴜsᴇᴅ ɪɴ ɢʀᴏᴜᴘs.',
                quoted: msg
            });
            break;
        }

        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*\n\nᴏɴʟʏ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴs ᴄᴀɴ ᴜsᴇ ʜɪᴅᴇᴛᴀɢ.',
                quoted: msg
            });
            break;
        }

        if (!args.length) {
            await socket.sendMessage(sender, {
                text: `👻 *ʜɪᴅᴇᴛᴀɢ*\n\nsɪʟᴇɴᴛʟʏ ɴᴏᴛɪғʏ ᴀʟʟ ᴍᴇᴍʙᴇʀs.\n\n*ᴜsᴀɢᴇ:* \`${prefix}hidetag <message>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}hidetag ɪᴍᴘᴏʀᴛᴀɴᴛ ᴍᴇᴇᴛɪɴɢ!\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '👻', key: msg.key } });

        const groupMetadata = await socket.groupMetadata(from);
        const participants = groupMetadata?.participants || [];

        if (!participants.length) {
            await socket.sendMessage(sender, {
                text: '❌ *ғᴀɪʟᴇᴅ*\n\nᴄᴏᴜʟᴅ ɴᴏᴛ ғᴇᴛᴄʜ ɢʀᴏᴜᴘ ᴍᴇᴍʙᴇʀs.',
                quoted: msg
            });
            break;
        }

        const mentions = participants.map(p => p.id);
        const text = args.join(' ');

        await socket.sendMessage(from, { text, mentions });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Hidetag] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
case 'leave': {
  try {
    // Add reaction immediately
    await socket.sendMessage(sender, { react: { text: '👋', key: msg.key } });
    
    // Check if in a group
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, {
        text: "❌ *This command can only be used in groups*",
        buttons: [
          {
            buttonId: `${config.PREFIX}join`,
            buttonText: { displayText: '👥 Join Group' },
            type: 1
          },
          {
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: '📋 Menu' },
            type: 1
          }
        ]
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
      break;
    }
    
    // Send goodbye message
    await socket.sendMessage(from, {
      text: "👋 *Goodbye!*\n\nThanks for using caseyrhodes bot.\nBot is now leaving this group.",
      footer: 'caseyrhodes Group Management'
    });
    
    // Leave the group
    await socket.groupLeave(from);
    
    console.log(`Bot left group: ${from}`);
    
  } catch (error) {
    console.error('Leave group error:', error);
    
    // Send error message
    let errorMsg = "❌ *Failed to leave group*\n\n";
    
    if (error.message.includes('not in group')) {
      errorMsg += "• Bot is not in this group\n";
      errorMsg += "• May have already been removed";
    } else if (error.message.includes('permission')) {
      errorMsg += "• Insufficient permissions\n";
      errorMsg += "• Bot may not be admin";
    } else {
      errorMsg += `• Error: ${error.message}\n`;
      errorMsg += "• Try removing bot manually";
    }
    
    await socket.sendMessage(from, {
      text: errorMsg,
      buttons: [
        {
          buttonId: `${config.PREFIX}kickme`,
          buttonText: { displayText: '🦶 Kick Bot' },
          type: 1
        }
      ]
    }, { quoted: msg });
    
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
                // Case: kick - Remove a member from the group
                case 'kick': {
                await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can kick members, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}kick +254740007567 or reply to a message with ${config.PREFIX}kick`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToKick;
                        if (msg.quoted) {
                            numberToKick = msg.quoted.sender;
                        } else {
                            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '🗑️ MEMBER KICKED',
                                `Successfully removed ${numberToKick.split('@')[0]} from the group! 🚪`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Kick command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to kick member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                
         //get github username details 
case 'github':
case 'gh': {
  try {
    const username = args[0];

    if (!username) {
      await socket.sendMessage(from, {
        text: '📦 *Please provide a GitHub username.*\nExample: .github caseyrhodes'
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

    try {
      const response = await axios.get(`https://api.github.com/users/${username}`);
      const data = response.data;

      if (data.message === 'Not Found') {
        await socket.sendMessage(from, {
          text: '❌ *GitHub user not found.*\nPlease check the username and try again.'
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        break;
      }

      const profilePic = `https://github.com/${data.login}.png`;

      const userInfo = `
🌐 *GitHub User Info*

👤 *Name:* ${data.name || 'N/A'}
🔖 *Username:* ${data.login}
📝 *Bio:* ${data.bio || 'N/A'}
🏢 *Company:* ${data.company || 'N/A'}
📍 *Location:* ${data.location || 'N/A'}
📧 *Email:* ${data.email || 'N/A'}
🔗 *Blog:* ${data.blog || 'N/A'}
📂 *Public Repos:* ${data.public_repos}
👥 *Followers:* ${data.followers}
🤝 *Following:* ${data.following}
📅 *Created:* ${new Date(data.created_at).toLocaleDateString()}
🔄 *Updated:* ${new Date(data.updated_at).toLocaleDateString()}
      `.trim();

      // Create a button to download the profile info
      const buttonMessage = {
        image: { url: profilePic },
        caption: userInfo,
        footer: 'Click the button below to download this profile info',
        buttons: [
          {
            buttonId: `.allmenu`,
            buttonText: { displayText: '🎀ᴀʟʟ ᴍᴇɴᴜ ' },
            type: 1
          }
        ],
        headerType: 4
      };

      await socket.sendMessage(from, buttonMessage, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (err) {
      console.error('GitHub API error:', err);
      await socket.sendMessage(from, {
        text: '⚠️ Error fetching GitHub user. Please try again later.'
      }, { quoted: msg });
      await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
  } catch (error) {
    console.error('GitHub command error:', error);
    await socket.sendMessage(from, {
      text: '❌ An unexpected error occurred. Please try again.'
    }, { quoted: msg });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//case ginfo
// Case: setname / groupname - Change group name
case 'setname':
case 'groupname': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const name = args.join(' ').trim();
        if (!name) {
            await socket.sendMessage(sender, {
                text: `📝 *sᴇᴛ ɢʀᴏᴜᴘ ɴᴀᴍᴇ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}setname <new name>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}setname My Cool Group\``,
                quoted: msg
            });
            break;
        }
        if (name.length > 100) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ɴᴀᴍᴇ ᴄᴀɴɴᴏᴛ ᴇxᴄᴇᴇᴅ 100 ᴄʜᴀʀᴀᴄᴛᴇʀs.*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });
        await socket.groupUpdateSubject(from, name);
        await socket.sendMessage(sender, {
            text: `✅ *ɢʀᴏᴜᴘ ɴᴀᴍᴇ ᴜᴘᴅᴀᴛᴇᴅ!*\n\n📛 *${name}*\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Setname] Error:', error.message);
        await socket.sendMessage(sender, { text: `❌ ${error.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: setdesc / setdescription / groupdesc - Change group description
case 'setdesc':
case 'setdescription':
case 'groupdesc': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        const desc = args.join(' ').trim();
        if (!desc) {
            await socket.sendMessage(sender, {
                text: `📝 *sᴇᴛ ɢʀᴏᴜᴘ ᴅᴇsᴄʀɪᴘᴛɪᴏɴ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}setdesc <description>\`\n\n*ᴇxᴀᴍᴘʟᴇ:* \`${prefix}setdesc Welcome to my group!\``,
                quoted: msg
            });
            break;
        }
        if (desc.length > 512) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴅᴇsᴄʀɪᴘᴛɪᴏɴ ᴄᴀɴɴᴏᴛ ᴇxᴄᴇᴇᴅ 512 ᴄʜᴀʀᴀᴄᴛᴇʀs.*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📝', key: msg.key } });
        await socket.groupUpdateDescription(from, desc);
        await socket.sendMessage(sender, {
            text: `✅ *ɢʀᴏᴜᴘ ᴅᴇsᴄʀɪᴘᴛɪᴏɴ ᴜᴘᴅᴀᴛᴇᴅ!*\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Setdesc] Error:', error.message);
        await socket.sendMessage(sender, { text: `❌ ${error.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: admins / listadmins / adminlist - List all group admins
case 'admins':
case 'listadmins':
case 'adminlist': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🛡️', key: msg.key } });

        const meta = await socket.groupMetadata(from);
        const admins = meta.participants.filter(m => m.admin);
        
        if (!admins.length) {
            await socket.sendMessage(sender, {
                text: '❌ ɴᴏ ᴀᴅᴍɪɴs ғᴏᴜɴᴅ.',
                quoted: msg
            });
            break;
        }

        const list = admins.map((m, i) => {
            const num = m.id.split('@')[0];
            const role = m.admin === 'superadmin' ? '👑 sᴜᴘᴇʀ ᴀᴅᴍɪɴ' : '🛡️ ᴀᴅᴍɪɴ';
            return `${i + 1}. @${num} — ${role}`;
        }).join('\n');

        const mentions = admins.map(m => m.id);

        await socket.sendMessage(sender, {
            text: `🛡️ *${meta.subject} — ᴀᴅᴍɪɴs*\n\n${list}\n\n📊 ᴛᴏᴛᴀʟ ᴀᴅᴍɪɴs: ${admins.length}\n\n> ${config.BOT_FOOTER}`,
            mentions: mentions,
            buttons: [
                { buttonId: `${prefix}tagadmins`, buttonText: { displayText: '🎌 ᴛᴀɢ ᴀᴅᴍɪɴs' }, type: 1 },
                { buttonId: `${prefix}members`, buttonText: { displayText: '👥 ᴍᴇᴍʙᴇʀs' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[Admins]', e.message);
        await socket.sendMessage(sender, {
            text: `❌ ғᴀɪʟᴇᴅ: ${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// Helper case for members list
// Case: members / listmembers / memberlist - List all group members
case 'members':
case 'listmembers':
case 'memberlist': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '👥', key: msg.key } });

        const meta = await socket.groupMetadata(from);
        const members = meta.participants || [];
        const total = members.length;
        const admins = members.filter(m => m.admin).length;
        
        const list = members.map((m, i) => {
            const num = m.id.split('@')[0];
            const role = m.admin === 'superadmin' ? '👑' : m.admin ? '🛡️' : '👤';
            return `${role} ${i + 1}. @${num}`;
        }).join('\n');

        const mentions = members.map(m => m.id);

        await socket.sendMessage(sender, {
            text: `👥 *${meta.subject} — ᴍᴇᴍʙᴇʀs*\n\n${list}\n\n📊 ᴛᴏᴛᴀʟ: ${total} | 🛡️ ᴀᴅᴍɪɴs: ${admins} | 👤 ᴍᴇᴍʙᴇʀs: ${total - admins}\n\n> ${config.BOT_FOOTER}`,
            mentions: mentions,
            buttons: [
                { buttonId: `${prefix}tagall`, buttonText: { displayText: '👥 ᴛᴀɢ ᴀʟʟ' }, type: 1 },
                { buttonId: `${prefix}ginfo`, buttonText: { displayText: '📊 ɢʀᴏᴜᴘ ɪɴғᴏ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[Members]', e.message);
        await socket.sendMessage(sender, {
            text: `❌ ғᴀɪʟᴇᴅ: ${e.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
 // Case: promote - Promote a member to group admin
                case 'promote': {
                await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can promote members, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}promote +254740007567 or reply to a message with ${config.PREFIX}promote`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToPromote;
                        if (msg.quoted) {
                            numberToPromote = msg.quoted.sender;
                        } else {
                            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '⬆️ MEMBER PROMOTED',
                                `Successfully promoted ${numberToPromote.split('@')[0]} to group admin! 🌟`,
                                config.BOT_FOOTER
                            )
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Promote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to promote member, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                // Case: demote - Demote a group admin to member
               case 'demote': {
    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘',
            buttons: [
                {buttonId: 'groups', buttonText: {displayText: 'My Groups'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can demote admins, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (args.length === 0 && !msg.quoted) {
        await socket.sendMessage(sender, {
            text: `📌 *Usage:* ${config.PREFIX}demote +254740007567 or reply to a message with ${config.PREFIX}demote`,
            buttons: [
                {buttonId: 'demote-help', buttonText: {displayText: 'Usage Examples'}, type: 1}
            ]
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        let numberToDemote;
        if (msg.quoted) {
            numberToDemote = msg.quoted.sender;
        } else {
            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        }
        
        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
        
        await socket.sendMessage(sender, {
            text: formatMessage(
                '⬇️ ADMIN DEMOTED',
                `Successfully demoted ${numberToDemote.split('@')[0]} 📉`,
                config.BOT_FOOTER
            ),
            buttons: [
                {buttonId: 'adminlist', buttonText: {displayText: 'View Admins'}, type: 1}
            ]
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error('Demote command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to demote admin, love!* 😢\nError: ${error.message || 'Unknown error'}`,
            buttons: [
                {buttonId: 'tryagain', buttonText: {displayText: 'Try Again'}, type: 1}
            ]
        }, { quoted: fakevCard });
    }
    break;
}

// Case: livescore - Live football scores
case 'livescore': {
    try {
        await socket.sendMessage(sender, { react: { text: '⚽', key: msg.key } });
        
        const res = await axios.get('https://api.sofascore.com/api/v1/sport/football/events/live', {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
            timeout: 12000
        });
        const events = res.data?.events?.slice(0, 10) || [];
        if (!events.length) {
            await socket.sendMessage(sender, {
                text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\nɴᴏ ʟɪᴠᴇ ᴍᴀᴛᴄʜᴇs ʀɪɢʜᴛ ɴᴏᴡ.\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }
        const list = events.map(e => {
            const h = e.homeTeam?.name || '?';
            const a = e.awayTeam?.name || '?';
            const hs = e.homeScore?.current ?? '-';
            const as = e.awayScore?.current ?? '-';
            return `⚽ *${h}* ${hs} - ${as} *${a}*`;
        }).join('\n');
        await socket.sendMessage(sender, {
            text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\n${list}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `⚽ *ʟɪᴠᴇ sᴄᴏʀᴇs*\n\nᴄᴏᴜʟᴅ ɴᴏᴛ ғᴇᴛᴄʜ ᴅᴀᴛᴀ.\n🔗 https://www.sofascore.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: sportnews - Sports news
case 'sportnews': {
    try {
        const q = args.join(' ') || 'football';
        await socket.sendMessage(sender, { react: { text: '🏆', key: msg.key } });
        
        const res = await axios.get(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=demo`, { timeout: 10000 });
        const articles = res.data?.articles || [];
        if (!articles.length) throw new Error('no articles');
        const list = articles.slice(0, 5).map((a, i) =>
            `*${i + 1}.* ${a.title}\n   📰 ${a.source?.name}`
        ).join('\n\n');
        await socket.sendMessage(sender, {
            text: `🏆 *sᴘᴏʀᴛs ɴᴇᴡs:* ${q}\n\n${list}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `🏆 *sᴘᴏʀᴛs ɴᴇᴡs*\n\n📰 ᴄʜᴇᴄᴋ:\n• https://www.bbc.com/sport\n• https://www.espn.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: standings - League standings
case 'standings': {
    try {
        const league = args.join(' ') || 'premier league';
        await socket.sendMessage(sender, { react: { text: '🏆', key: msg.key } });
        
        const res = await axios.get(`https://api.siputzx.my.id/api/sports/standings?league=${encodeURIComponent(league)}`, { timeout: 12000 });
        const teams = res.data?.data?.slice(0, 10) || [];
        if (!teams.length) throw new Error('no data');
        const list = teams.map(t =>
            `${t.rank || '?'}. ${t.name || t.team} | Pts: ${t.points}`
        ).join('\n');
        await socket.sendMessage(sender, {
            text: `🏆 *sᴛᴀɴᴅɪɴɢs: ${league}*\n\n${list}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `🏆 *${args.join(' ') || 'premier league'} sᴛᴀɴᴅɪɴɢs*\n\n🔗 https://www.flashscore.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: topscorers - Top goal scorers
case 'topscorers': {
    try {
        const league = args.join(' ') || 'premier league';
        await socket.sendMessage(sender, { react: { text: '⚽', key: msg.key } });
        
        const res = await axios.get(`https://api.siputzx.my.id/api/sports/topscorers?league=${encodeURIComponent(league)}`, { timeout: 12000 });
        const players = res.data?.data?.slice(0, 10) || [];
        if (!players.length) throw new Error('no data');
        const list = players.map((p, i) =>
            `*${i + 1}.* ${p.name || p.player} (${p.team}) — ⚽ ${p.goals}`
        ).join('\n');
        await socket.sendMessage(sender, {
            text: `⚽ *ᴛᴏᴘ sᴄᴏʀᴇʀs: ${league}*\n\n${list}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    } catch {
        await socket.sendMessage(sender, {
            text: `⚽ *ᴛᴏᴘ sᴄᴏʀᴇʀs:s ${args.join(' ') || 'premier league'}*\n\n🔗 https://www.whoscored.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: upcomingmatches - Team upcoming matches
case 'upcomingmatches': {
    try {
        const team = args.join(' ') || 'chelsea';
        await socket.sendMessage(sender, { react: { text: '📅', key: msg.key } });
        
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/search/${encodeURIComponent(team)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
        });
        const teamId = res.data?.teams?.[0]?.id;
        if (teamId) {
            const matches = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}/events/next/0`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
            });
            const events = matches.data?.events?.slice(0, 5) || [];
            if (events.length) {
                const list = events.map(e => {
                    const d = new Date(e.startTimestamp * 1000);
                    return `📅 ${d.toDateString()} | ${e.homeTeam?.name} vs ${e.awayTeam?.name}`;
                }).join('\n');
                await socket.sendMessage(sender, {
                    text: `📅 *ᴜᴘᴄᴏᴍɪɴɢ: ${team.toUpperCase()}*\n\n${list}\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }
        }
        throw new Error('no matches');
    } catch {
        await socket.sendMessage(sender, {
            text: `📅 *ᴜᴘᴄᴏᴍɪɴɢ: ${args.join(' ') || 'chelsea'}*\n\n🔗 https://www.sofascore.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}

// Case: gamehistory - Team match history
case 'gamehistory': {
    try {
        const team = args.join(' ') || 'chelsea';
        await socket.sendMessage(sender, { react: { text: '📋', key: msg.key } });
        
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/search/${encodeURIComponent(team)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
        });
        const teamId = res.data?.teams?.[0]?.id;
        if (teamId) {
            const hist = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}/events/last/0`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000
            });
            const events = hist.data?.events?.slice(-5).reverse() || [];
            if (events.length) {
                const list = events.map(e => {
                    const d = new Date(e.startTimestamp * 1000);
                    const hs = e.homeScore?.current ?? '-';
                    const as = e.awayScore?.current ?? '-';
                    return `📅 ${d.toDateString()}\n   ${e.homeTeam?.name} ${hs}-${as} ${e.awayTeam?.name}`;
                }).join('\n\n');
                await socket.sendMessage(sender, {
                    text: `📋 *ʜɪsᴛᴏʀʏ: ${team.toUpperCase()}*\n\n${list}\n\n> ${config.BOT_FOOTER}`,
                    quoted: msg
                });
                break;
            }
        }
        throw new Error('no history');
    } catch {
        await socket.sendMessage(sender, {
            text: `📋 *ʜɪsᴛᴏʀʏ: ${args.join(' ') || 'chelsea'}*\n\n🔗 https://www.sofascore.com\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });
    }
    break;
}
// Case: grouplink / invitelink / link - Get or revoke group invite link
case 'grouplink':
case 'invitelink':
case 'link': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

        const code = await socket.groupInviteCode(from);
        const link = `https://chat.whatsapp.com/${code}`;

        await socket.sendMessage(sender, {
            text: `🔗 *ɢʀᴏᴜᴘ ɪɴᴠɪᴛᴇ ʟɪɴᴋ*\n\n${link}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}revoke`, buttonText: { displayText: '🔄 ʀᴇᴠᴏᴋᴇ ʟɪɴᴋ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Link] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: revoke / revokelink - Revoke group invite link
case 'revoke':
case 'revokelink': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }
        if (!isSenderGroupAdmin && !isOwner) {
            await socket.sendMessage(sender, {
                text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*',
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '🔄', key: msg.key } });

        await socket.groupRevokeInvite(from);
        const newCode = await socket.groupInviteCode(from);
        const newLink = `https://chat.whatsapp.com/${newCode}`;

        await socket.sendMessage(sender, {
            text: `🔄 *ɪɴᴠɪᴛᴇ ʟɪɴᴋ ʀᴇᴠᴏᴋᴇᴅ!*\n\nɴᴇᴡ ʟɪɴᴋ:\n${newLink}\n\n> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}link`, buttonText: { displayText: '🔗 ɢᴇᴛ ʟɪɴᴋ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (error) {
        console.error('[Revoke] Error:', error.message);
        await socket.sendMessage(sender, {
            text: `❌ *ғᴀɪʟᴇᴅ*\n\n${error.message}`,
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                // Case: open - Unlock group (allow all members to send messages)
case 'open': {
    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can open the group, sweetie!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'not_announcement');
        
        // Send success message with buttons
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🔓 GROUP OPENED\n\n' +
                'Group is now open!🗣️\n\n' +
                config.BOT_FOOTER
            ),
            buttons: [
                {
                    buttonId: '.close',
                    buttonText: { displayText: '🔒 Close Group' },
                    type: 1
                },
                {
                    buttonId: '.settings',
                    buttonText: { displayText: '⚙️ Group Settings' },
                    type: 1
                }
            ]
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Open command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to open group, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: close - Lock group (only admins can send messages)
case 'close': {
    await socket.sendMessage(sender, { react: { text: '🔒', key: msg.key } });
    
    if (!isGroup) {
        await socket.sendMessage(sender, {
            text: '❌ *This command can only be used in groups, sweetie!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    if (!isSenderGroupAdmin && !isOwner) {
        await socket.sendMessage(sender, {
            text: '❌ *Only group admins or bot owner can close the group, darling!* 😘'
        }, { quoted: fakevCard });
        break;
    }
    
    try {
        await socket.groupSettingUpdate(from, 'announcement');
        
        // Create buttons for opening the group and settings
        const buttons = [
            { buttonId: '.open', buttonText: { displayText: 'Open Group' }, type: 1 },
            { buttonId: '.settings', buttonText: { displayText: 'Settings' }, type: 1 }
        ];
        
        // Send success message with buttons
        await socket.sendMessage(sender, {
            text: formatMessage(
                '🔒 GROUP CLOSED',
                'Group is now closed!:',
                config.BOT_FOOTER
            ),
            buttons: buttons,
            headerType: 1
        }, { quoted: fakevCard });
    } catch (error) {
        console.error('Close command error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to close group, love!* 😢\nError: ${error.message || 'Unknown error'}`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: accept / acceptall - Accept join requests
case 'accept':
case 'acceptall': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        const reqs = await socket.groupRequestParticipantsList(from);
        if (!reqs?.length) { await socket.sendMessage(sender, { text: '📋 ɴᴏ ᴘᴇɴᴅɪɴɢ ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs.', quoted: msg }); break; }

        await socket.groupRequestParticipantsUpdate(from, reqs.map(r => r.jid), 'approve');
        await socket.sendMessage(sender, { text: `✅ ᴀᴘᴘʀᴏᴠᴇᴅ ᴀʟʟ *${reqs.length}* ʀᴇǫᴜᴇsᴛs.\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: reject / rejectall - Reject join requests
case 'reject':
case 'rejectall': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        const reqs = await socket.groupRequestParticipantsList(from);
        if (!reqs?.length) { await socket.sendMessage(sender, { text: '📋 ɴᴏ ᴘᴇɴᴅɪɴɢ ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs.', quoted: msg }); break; }

        await socket.groupRequestParticipantsUpdate(from, reqs.map(r => r.jid), 'reject');
        await socket.sendMessage(sender, { text: `❌ ʀᴇᴊᴇᴄᴛᴇᴅ ᴀʟʟ *${reqs.length}* ʀᴇǫᴜᴇsᴛs.\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: listrequests - List join requests
case 'listrequests': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.sendMessage(sender, { react: { text: '📋', key: msg.key } });
        const reqs = await socket.groupRequestParticipantsList(from);
        if (!reqs?.length) { await socket.sendMessage(sender, { text: '📋 ɴᴏ ᴘᴇɴᴅɪɴɢ ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs.', quoted: msg }); break; }

        const list = reqs.slice(0, 20).map((r, i) => `*${i + 1}.* +${r.jid?.split('@')[0]}`).join('\n');
        await socket.sendMessage(sender, { text: `📋 *ᴊᴏɪɴ ʀᴇǫᴜᴇsᴛs (${reqs.length})*\n\n${list}\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: groupsettings - Show group settings
case 'groupsettings': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.sendMessage(sender, { react: { text: '⚙️', key: msg.key } });
        const meta = await socket.groupMetadata(from);
        const p = meta.participants || [];
        const admins = p.filter(x => x.admin).length;
        const ephem = meta.ephemeralDuration;
        const label = ephem ? (ephem === 86400 ? '24h' : ephem === 604800 ? '7d' : '90d') : 'OFF';

        await socket.sendMessage(sender, {
            text: `⚙️ *ɢʀᴏᴜᴘ sᴇᴛᴛɪɴɢs*\n\n` +
                  `👥 ᴍᴇᴍʙᴇʀs: *${p.length}*\n` +
                  `👑 ᴀᴅᴍɪɴs: *${admins}*\n` +
                  `🔒 ʟᴏᴄᴋᴇᴅ: *${meta.announce ? 'Yes' : 'No'}*\n` +
                  `⏳ ᴅɪsᴀᴘᴘᴇᴀʀ: *${label}*\n\n` +
                  `> ${config.BOT_FOOTER}`,
            buttons: [
                { buttonId: `${prefix}ginfo`, buttonText: { displayText: '📊 ɢʀᴏᴜᴘ ɪɴғᴏ' }, type: 1 },
                { buttonId: `${prefix}menu`, buttonText: { displayText: '📋 ᴍᴇɴᴜ' }, type: 1 }
            ],
            headerType: 1
        }, { quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg }); }
    break;
}

// Case: everyone - Tag all members
case 'everyone': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        const meta = await socket.groupMetadata(from);
        const participants = meta.participants || [];
        const text = args.join(' ').trim() || '👋 ᴀᴛᴛᴇɴᴛɪᴏɴ ᴇᴠᴇʀʏᴏɴᴇ!';
        const mentions = participants.map(p => p.id);

        await socket.sendMessage(from, { text, mentions });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (e) { await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg }); }
    break;
}

// Case: mute / unmute - Mute/unmute group
case 'mute': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.groupSettingUpdate(from, 'announcement');
        await socket.sendMessage(sender, { text: `🔇 *ɢʀᴏᴜᴘ ᴍᴜᴛᴇᴅ!*\n\nᴏɴʟʏ ᴀᴅᴍɪɴs ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs.\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: unmute / open (when not adding)
case 'unmute': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.groupSettingUpdate(from, 'not_announcement');
        await socket.sendMessage(sender, { text: `🔊 *ɢʀᴏᴜᴘ ᴜɴᴍᴜᴛᴇᴅ!*\n\nᴇᴠᴇʀʏᴏɴᴇ ᴄᴀɴ sᴇɴᴅ ᴍᴇssᴀɢᴇs.\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: disapp - Set disappearing messages
case 'disapp': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        const secs = parseInt(args[0]) || 0;
        const valid = [0, 86400, 604800, 7776000];
        const v = valid.includes(secs) ? secs : 604800;
        await socket.groupToggleEphemeral(from, v);
        const label = v === 0 ? 'OFF' : v === 86400 ? '24h' : v === 604800 ? '7d' : '90d';
        await socket.sendMessage(sender, { text: `⏳ ᴅɪsᴀᴘᴘᴇᴀʀɪɴɢ ᴍᴇssᴀɢᴇs: *${label}*\n\n> ${config.BOT_FOOTER}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: del - Delete quoted message
case 'del': {
    try {
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isSenderGroupAdmin && !isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴀᴅᴍɪɴ ᴏɴʟʏ*', quoted: msg }); break; }

        const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;
        if (!key) { await socket.sendMessage(sender, { text: '❌ ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ ᴅᴇʟᴇᴛᴇ.', quoted: msg }); break; }

        await socket.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: key, participant } });
        await socket.sendMessage(sender, { react: { text: '🗑️', key: msg.key } });
    } catch { await socket.sendMessage(sender, { text: '❌ ғᴀɪʟᴇᴅ.', quoted: msg }); }
    break;
}

// Case: killgc - Bot leaves group (owner only)
case 'killgc': {
    try {
        if (!isOwner) { await socket.sendMessage(sender, { text: '❌ *ᴏᴡɴᴇʀ ᴏɴʟʏ*', quoted: msg }); break; }
        if (!isGroup) { await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg }); break; }

        await socket.sendMessage(from, { text: '💀 *ɢᴏᴏᴅʙʏᴇ!* ʙᴏᴛ ɪs ʟᴇᴀᴠɪɴɢ...' });
        await socket.groupLeave(from);
    } catch (e) { await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg }); }
    break;
}
                // Case: tagall - Tag all group members
                case 'tagall': {
                await socket.sendMessage(sender, { react: { text: '🫂', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *This command can only be used in groups, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only group admins or bot owner can tag all members, sweetie!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants.map(p => p.id);
                        const mentions = participants.map(p => ({
                            tag: 'mention',
                            attrs: { jid: p }
                        }));
                        let message = args.join(' ') || '📢 *Attention everyone!*';
                        await socket.sendMessage(from, {
                            text: formatMessage(
                                '👥 TAG ALL',
                                `${message}\n\nTagged ${participants.length} members!`,
                                config.BOT_FOOTER
                            ),
                            mentions: participants
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Tagall command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to tag all members, love!* 😢\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }
                // Case: vcfgen / savecontacts / exportvcf / contactsave - Generate VCF from mentioned users
case 'vcfgen':
case 'savecontacts':
case 'exportvcf':
case 'contactsave': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, {
                text: `❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*\n\nᴜsᴇ \`${prefix}vcfnumber <phone>\` ғᴏʀ sᴘᴇᴄɪғɪᴄ ɴᴜᴍʙᴇʀs.`,
                quoted: msg
            });
            break;
        }

        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

        if (!mentioned.length) {
            await socket.sendMessage(sender, {
                text: `📇 *ᴠᴄғ ɢᴇɴᴇʀᴀᴛᴏʀ*\n\nᴛᴀɢ ᴜsᴇʀs ᴛᴏ ᴄʀᴇᴀᴛᴇ ᴀ ᴠᴄғ ғɪʟᴇ.\n\n*ᴜsᴀɢᴇ:* \`${prefix}vcfgen @user1 @user2\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📇', key: msg.key } });

        const vcards = [];
        for (const mJid of mentioned) {
            const num = mJid.split('@')[0];
            const name = `Contact ${num}`;
            vcards.push(`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:+${num}\nEND:VCARD`);
        }

        const vcfContent = vcards.join('\n');
        const buf = Buffer.from(vcfContent, 'utf8');

        await socket.sendMessage(sender, {
            document: buf,
            mimetype: 'text/x-vcard',
            fileName: `contacts_${vcards.length}.vcf`,
            caption: `📇 *ᴠᴄғ ɢᴇɴᴇʀᴀᴛᴇᴅ — ${vcards.length} ᴄᴏɴᴛᴀᴄᴛ(s)*\n\n> ${config.BOT_FOOTER}`
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[VCF] Error:', e.message);
        await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: vcfnumber - Generate VCF from phone numbers
case 'vcfnumber': {
    try {
        const numbers = args.filter(a => /^\+?\d{7,15}$/.test(a.replace(/[\s\-()]/g, '')));
        if (!numbers.length) {
            await socket.sendMessage(sender, {
                text: `📇 *ᴠᴄғ ғʀᴏᴍ ɴᴜᴍʙᴇʀ*\n\n*ᴜsᴀɢᴇ:* \`${prefix}vcfnumber 254712345678\`\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📇', key: msg.key } });

        const vcards = [];
        for (const raw of numbers) {
            const phone = raw.replace(/[\s\-()+]/g, '');
            vcards.push(`BEGIN:VCARD\nVERSION:3.0\nFN:Contact +${phone}\nTEL;TYPE=CELL:+${phone}\nEND:VCARD`);
        }

        const vcfContent = vcards.join('\n');
        const buf = Buffer.from(vcfContent, 'utf8');

        await socket.sendMessage(sender, {
            document: buf,
            mimetype: 'text/x-vcard',
            fileName: `contacts_${numbers.length}.vcf`,
            caption: `📇 *ᴠᴄғ ɢᴇɴᴇʀᴀᴛᴇᴅ — ${numbers.length} ᴄᴏɴᴛᴀᴄᴛ(s)*\n\n> ${config.BOT_FOOTER}`
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[VCF] Error:', e.message);
        await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: vcfgroup - Generate VCF from all group members
case 'vcfgroup': {
    try {
        if (!isGroup) {
            await socket.sendMessage(sender, { text: '❌ *ɢʀᴏᴜᴘ ᴏɴʟʏ*', quoted: msg });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📇', key: msg.key } });

        const meta = await socket.groupMetadata(from);
        const participants = meta?.participants || [];
        if (!participants.length) {
            await socket.sendMessage(sender, { text: '❌ ᴄᴏᴜʟᴅ ɴᴏᴛ ғᴇᴛᴄʜ ᴍᴇᴍʙᴇʀs.', quoted: msg });
            break;
        }

        const vcards = [];
        for (const p of participants) {
            const num = p.id.split('@')[0];
            const name = `Member ${num}`;
            vcards.push(`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;TYPE=CELL:+${num}\nEND:VCARD`);
        }

        const vcfContent = vcards.join('\n');
        const buf = Buffer.from(vcfContent, 'utf8');
        const groupName = (meta.subject || 'group').replace(/[^a-zA-Z0-9]/g, '_');

        await socket.sendMessage(sender, {
            document: buf,
            mimetype: 'text/x-vcard',
            fileName: `${groupName}_contacts.vcf`,
            caption: `📇 *ᴠᴄғ ɢᴇɴᴇʀᴀᴛᴇᴅ — ${vcards.length} ᴄᴏɴᴛᴀᴄᴛ(s)*\n\n> ${config.BOT_FOOTER}`
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[VCF] Error:', e.message);
        await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// Case: vcfread / readvcf / vcfview - Read VCF file content
case 'vcfread':
case 'readvcf':
case 'vcfview': {
    try {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const docMsg = quotedMsg?.documentMessage || msg.message?.documentMessage;

        if (!docMsg) {
            await socket.sendMessage(sender, {
                text: `📇 *ᴠᴄғ ʀᴇᴀᴅᴇʀ*\n\nʀᴇᴘʟʏ ᴛᴏ ᴀ .ᴠᴄғ ғɪʟᴇ ᴛᴏ ᴠɪᴇᴡ ɪᴛs ᴄᴏɴᴛᴇɴᴛs.\n\n> ${config.BOT_FOOTER}`,
                quoted: msg
            });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '📇', key: msg.key } });

        const stream = await downloadContentFromMessage(docMsg, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const vcfText = buffer.toString('utf8');

        // Parse contacts
        const cards = vcfText.split(/(?=BEGIN:VCARD)/i).filter(c => c.trim());
        if (!cards.length) {
            await socket.sendMessage(sender, { text: '❌ ɴᴏ ᴄᴏɴᴛᴀᴄᴛs ғᴏᴜɴᴅ.', quoted: msg });
            break;
        }

        const contacts = cards.slice(0, 30).map(card => {
            const fnMatch = card.match(/^FN[;:](.+)$/mi);
            const telMatch = card.match(/^TEL[^:]*:(.+)$/mi);
            const name = (fnMatch?.[1] || 'Unknown').trim();
            const phone = (telMatch?.[1] || 'N/A').trim();
            return `📛 ${name}\n📞 ${phone}`;
        }).join('\n\n');

        await socket.sendMessage(sender, {
            text: `📇 *ᴠᴄғ ᴄᴏɴᴛᴇɴᴛs* — ${cards.length} ᴄᴏɴᴛᴀᴄᴛ(s)\n\n${contacts}\n\n> ${config.BOT_FOOTER}`,
            quoted: msg
        });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error('[VCF] Error:', e.message);
        await socket.sendMessage(sender, { text: `❌ ${e.message}`, quoted: msg });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                // Case: join - Join a group via invite link
                case 'join': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *Only bot owner can use this command, darling!* 😘'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *Usage:* ${config.PREFIX}join <group-invite-link>\n\nExample: ${config.PREFIX}join https://chat.whatsapp.com/xxxxxxxxxxxxxxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                    await socket.sendMessage(sender, { react: { text: '👏', key: msg.key } });
                        const inviteLink = args[0];
                        const inviteCodeMatch = inviteLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
                        if (!inviteCodeMatch) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Invalid group invite link format, love!* 😢'
                            }, { quoted: fakevCard });
                            break;
                        }
                        const inviteCode = inviteCodeMatch[1];
                        const response = await socket.groupAcceptInvite(inviteCode);
                        if (response?.gid) {
                            await socket.sendMessage(sender, {
                                text: formatMessage(
                                    '🤝 GROUP JOINED',
                                    `Successfully joined group with ID: ${response.gid}! 🎉`,
                                    config.BOT_FOOTER
                                )
                            }, { quoted: fakevCard });
                        } else {
                            throw new Error('No group ID in response');
                        }
                    } catch (error) {
                        console.error('Join command error:', error);
                        let errorMessage = error.message || 'Unknown error';
                        if (error.message.includes('not-authorized')) {
                            errorMessage = 'Bot is not authorized to join (possibly banned)';
                        } else if (error.message.includes('conflict')) {
                            errorMessage = 'Bot is already a member of the group';
                        } else if (error.message.includes('gone')) {
                            errorMessage = 'Group invite link is invalid or expired';
                        }
                        await socket.sendMessage(sender, {
                            text: `❌ *Failed to join group, love!* 😢\nError: ${errorMessage}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

    case 'quote': {
    await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });
        try {
            
            const response = await fetch('https://api.quotable.io/random');
            const data = await response.json();
            if (!data.content) {
                throw new Error('No quote found');
            }
            await socket.sendMessage(sender, {
                text: formatMessage(
                    '💭 SPICY QUOTE',
                    `📜 "${data.content}"\n— ${data.author}`,
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            }, { quoted: fakevCard });
        } catch (error) {
            console.error('Quote command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, sweetie, the quotes got shy! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
    
//    case 37

case 'apk': {
    try {
        const appName = args.join(' ').trim();
        if (!appName) {
            await socket.sendMessage(sender, { text: '📌 Usage: .apk <app name>\nExample: .apk whatsapp' }, { quoted: fakevCard });
            break;
        }

        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

        const apiUrl = `https://api.nexoracle.com/downloader/apk?q=${encodeURIComponent(appName)}&apikey=free_key@maher_apis`;
        console.log('Fetching APK from:', apiUrl);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`API request failed with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', JSON.stringify(data, null, 2));

        if (!data || data.status !== 200 || !data.result || typeof data.result !== 'object') {
            await socket.sendMessage(sender, { text: '❌ Unable to find the APK. The API returned invalid data.' }, { quoted: fakevCard });
            break;
        }

        const { name, lastup, package, size, icon, dllink } = data.result;
        if (!name || !dllink) {
            console.error('Invalid result data:', data.result);
            await socket.sendMessage(sender, { text: '❌ Invalid APK data: Missing name or download link.' }, { quoted: fakevCard });
            break;
        }

        // Validate icon URL
        if (!icon || !icon.startsWith('http')) {
            console.warn('Invalid or missing icon URL:', icon);
        }

        await socket.sendMessage(sender, {
            image: { url: icon || 'https://via.placeholder.com/150' }, // Fallback image if icon is invalid
            caption: formatMessage(
                '📦 DOWNLOADING APK',
                `Downloading ${name}... Please wait.`,
                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            )
        }, { quoted: fakevCard });

        console.log('Downloading APK from:', dllink);
        const apkResponse = await fetch(dllink, { headers: { 'Accept': 'application/octet-stream' } });
        const contentType = apkResponse.headers.get('content-type');
        if (!apkResponse.ok || (contentType && !contentType.includes('application/vnd.android.package-archive'))) {
            throw new Error(`Failed to download APK: Status ${apkResponse.status}, Content-Type: ${contentType || 'unknown'}`);
        }

        const apkBuffer = await apkResponse.arrayBuffer();
        if (!apkBuffer || apkBuffer.byteLength === 0) {
            throw new Error('Downloaded APK is empty or invalid');
        }
        const buffer = Buffer.from(apkBuffer);

        // Validate APK file (basic check for APK signature)
        if (!buffer.slice(0, 2).toString('hex').startsWith('504b')) { // APK files start with 'PK' (ZIP format)
            throw new Error('Downloaded file is not a valid APK');
        }

        await socket.sendMessage(sender, {
            document: buffer,
            mimetype: 'application/vnd.android.package-archive',
            fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.apk`, // Sanitize filename
            caption: formatMessage(
                '📦 APK DETAILS',
                `🔖 Name: ${name || 'N/A'}\n📅 Last Update: ${lastup || 'N/A'}\n📦 Package: ${package || 'N/A'}\n📏 Size: ${size || 'N/A'}`,
                'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            )
        }, { quoted: fakevCard });

        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
    } catch (error) {
        console.error('APK command error:', error.message, error.stack);
        await socket.sendMessage(sender, { text: `❌ Oh, love, couldn’t fetch the APK! 😢 Error: ${error.message}\nTry again later.` }, { quoted: fakevCard });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
// case 38: shorturl
case 'tiny':
case 'short':
case 'shorturl': {
    console.log("Command tiny triggered");
    
    if (!args[0]) {
        console.log("No URL provided");
        return await socket.sendMessage(sender, {
            text: "*🏷️ ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴍᴇ ᴀ ʟɪɴᴋ.*"
        }, { quoted: msg });
    }

    try {
        const link = args[0];
        console.log("URL to shorten:", link);
        const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(link)}`);
        const shortenedUrl = response.data;

        console.log("Shortened URL:", shortenedUrl);
        
        // Fetch an image for thumbnail (using a generic URL shortener icon)
        const thumbnailResponse = await axios.get('https://cdn-icons-png.flaticon.com/512/1006/1006771.png', { 
            responseType: 'arraybuffer' 
        });
        const thumbnailBuffer = Buffer.from(thumbnailResponse.data);
        
        const messageOptions = {
            text: `*🧑‍💻 YOUR SHORTENED URL*\n\n${shortenedUrl}`,
            headerType: 4,
            contextInfo: {
                mentionedJid: [msg.key.participant || msg.key.remoteJid],
                externalAdReply: {
                    title: 'powered by caseyrhodes tech 👻',
                    body: 'Link shortened successfully',
                    mediaType: 1,
                    sourceUrl: link,
                    thumbnail: thumbnailBuffer
                }
            }
        };
        
        return await socket.sendMessage(sender, messageOptions, { quoted: msg });
    } catch (e) {
        console.error("Error shortening URL:", e);
        return await socket.sendMessage(sender, {
            text: "An error occurred while shortening the URL. Please try again."
        }, { quoted: msg });
    }
    break;
}
///ᴏᴡɴᴇʀ ᴅᴇᴀᴛᴀɪʟs
case 'owner':
case 'creator':
case 'developer': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "👑", // Crown emoji for owner
            key: msg.key
        }
    });

    const botOwner = "ᴄᴀsᴇʏʀʜᴏᴅᴇs"; // Owner name
    const ownerNumber = "254704472907"; // Hardcoded owner number

    const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:${botOwner}
TEL;waid=${ownerNumber}:${ownerNumber}
END:VCARD
`;

    await socket.sendMessage(sender, {
        contacts: {
            displayName: botOwner,
            contacts: [{ vcard }]
        }
    }, { quoted: fakevCard });

    // Send message with button
    const buttonMessage = {
        text: `*👑 Bot Owner Details*\n\n` +
              `*Name:* ${botOwner}\n` +
              `*Contact:* ${ownerNumber}\n\n` +
              `> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ🌟`,
        footer: 'Need help or have questions?',
        buttons: [
            {
                buttonId: '.contact-owner',
                buttonText: { displayText: '🎀 Contact Owner' },
                type: 1
            }
        ],
        headerType: 1
    };

    await socket.sendMessage(sender, buttonMessage, { quoted: fakevCard });
    
    break;
}
// Add this to your button handling section
case 'contact-owner': {
    try {
        // Send a pre-filled message to contact the owner
        await socket.sendMessage(from, {
            text: `Hello! I'd like to get in touch with you about your bot.`
        }, { quoted: msg });
        
        // Optionally send the contact card again
        const botOwner = "ᴄᴀsᴇʏʀʜᴏᴅᴇs";
        const ownerNumber = "254704472907";
        
        const vcard = `
BEGIN:VCARD
VERSION:3.0
FN:${botOwner}
TEL;waid=${ownerNumber}:${ownerNumber}
END:VCARD
`;

        await socket.sendMessage(from, {
            contacts: {
                displayName: botOwner,
                contacts: [{ vcard }]
            }
        }, { quoted: msg });
        
    } catch (error) {
        console.error('Contact button error:', error);
        await socket.sendMessage(from, {
            text: '❌ Error processing your request.'
        }, { quoted: msg });
    }
    break;
}
// case 39: weather
case 'weather':
case 'climate': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "❄️", // Snowflake emoji for weather
            key: msg.key
        }
    });

    const axios = require('axios');

    // Extract query from message
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || '';
    
    const args = q.trim().split(' ').slice(1); // Remove the command itself
    const location = args.join(' ');

    if (!location) {
        return await socket.sendMessage(sender, {
            text: '❄️ *Please provide a location to check the weather!*\n\n' +
                  'Example: *.weather London*\n' +
                  'Example: *.weather New York*\n' +
                  'Example: *.weather Tokyo, Japan*'
        }, { quoted: fakevCard });
    }

    try {
        const res = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
            params: {
                q: location,
                units: 'metric',
                appid: '060a6bcfa19809c2cd4d97a212b19273',
                language: 'en'
            }
        });

        const data = res.data;
        const sunrise = new Date(data.sys.sunrise * 1000).toLocaleTimeString();
        const sunset = new Date(data.sys.sunset * 1000).toLocaleTimeString();
        const rain = data.rain ? data.rain['1h'] : 0;

        const text = `❄️ *🌸 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐖𝐄𝐀𝐓𝐇𝐄𝐑 🌸*\n\n` +
                     `*📍 Location:* ${data.name}, ${data.sys.country}\n\n` +
                     `🌡️ *Temperature:* ${data.main.temp}°C\n` +
                     `🤔 *Feels like:* ${data.main.feels_like}°C\n` +
                     `📉 *Min:* ${data.main.temp_min}°C  📈 *Max:* ${data.main.temp_max}°C\n` +
                     `📝 *Condition:* ${data.weather[0].description}\n` +
                     `💧 *Humidity:* ${data.main.humidity}%\n` +
                     `🌬️ *Wind:* ${data.wind.speed} m/s\n` +
                     `☁️ *Cloudiness:* ${data.clouds.all}%\n` +
                     `🌧️ *Rain (last hour):* ${rain} mm\n` +
                     `🌄 *Sunrise:* ${sunrise}\n` +
                     `🌅 *Sunset:* ${sunset}\n` +
                     `🧭 *Coordinates:* ${data.coord.lat}, ${data.coord.lon}\n\n` +
                     `_Powered by CaseyRhodes Tech_ 🌟`;

        await socket.sendMessage(sender, {
            text: text,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ🎀',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

    } catch (error) {
        console.error('[WEATHER ERROR]', error);
        await socket.sendMessage(sender, {
            text: '❌ *Failed to fetch weather data!*\n\n' +
                  'Please check:\n' +
                  '• Location spelling\n' +
                  '• Internet connection\n' +
                  '• Try a different location\n\n' +
                  'Example: *.weather Paris* or *.weather Mumbai*'
        }, { quoted: fakevCard });
    }
    break;
}
//Helloo
    case 'whois': {
        try {
            await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
            const domain = args[0];
            if (!domain) {
                await socket.sendMessage(sender, { text: '📌 Usage: .whois <domain>' }, { quoted: fakevCard });
                break;
            }
            const response = await fetch(`http://api.whois.vu/?whois=${encodeURIComponent(domain)}`);
            const data = await response.json();
            if (!data.domain) {
                throw new Error('Domain not found');
            }
            const whoisMessage = formatMessage(
                '🔍 WHOIS LOOKUP',
                `🌐 Domain: ${data.domain}\n` +
                `📅 Registered: ${data.created_date || 'N/A'}\n` +
                `⏰ Expires: ${data.expiry_date || 'N/A'}\n` +
                `📋 Registrar: ${data.registrar || 'N/A'}\n` +
                `📍 Status: ${data.status.join(', ') || 'N/A'}`,
                '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
            );
            await socket.sendMessage(sender, { text: whoisMessage }, { quoted: fakevCard });
        } catch (error) {
            console.error('Whois command error:', error);
            await socket.sendMessage(sender, { text: '❌ Oh, darling, couldn’t find that domain! 😢 Try again?' }, { quoted: fakevCard });
        }
        break;
    }
      //case repository 
      //case repository 
// Case: repo - Show repository information
// Case: github - Show GitHub repository info
// Case: repo / github / git / source / sc / script - Show repository info
case 'repo':
case 'github':
case 'git':
case 'source':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });
        
        const repoUrl = 'https://github.com/mruniquehacker/KnightBot-Mini';
        const apiUrl = 'https://api.github.com/repos/mruniquehacker/KnightBot-Mini';
        
        let message = '';
        
        try {
            const response = await axios.get(apiUrl, {
                headers: { 'User-Agent': 'KnightBot-Mini' },
                timeout: 5000
            });
            
            const repo = response.data;
            
            message = `╭━━『 *📦 ɢɪᴛʜᴜʙ ʀᴇᴘᴏ* 』━━╮\n\n` +
                      `🤖 *ʙᴏᴛ:* ${config.OWNER_NAME}\n` +
                      `📁 *ʀᴇᴘᴏ:* ${repo.name}\n` +
                      `👤 *ᴏᴡɴᴇʀ:* ${repo.owner.login}\n` +
                      `⭐ *sᴛᴀʀs:* ${repo.stargazers_count.toLocaleString()}\n` +
                      `🍴 *ғᴏʀᴋs:* ${repo.forks_count.toLocaleString()}\n` +
                      `📝 *ᴅᴇsᴄ:* ${repo.description || 'WhatsApp Bot'}\n\n` +
                      `🔗 *ʟɪɴᴋ:* ${repo.html_url}\n\n` +
                      `╰━━━━━━━━━━━━━━━╯\n\n` +
                      `> ${config.BOT_FOOTER}`;
            
        } catch (apiError) {
            message = `╭━━『 *📦 ɢɪᴛʜᴜʙ ʀᴇᴘᴏ* 』━━╮\n\n` +
                      `🤖 *ʙᴏᴛ:* ${config.OWNER_NAME}\n` +
                      `📁 *ʀᴇᴘᴏ:* KnightBot-Mini\n` +
                      `👤 *ᴏᴡɴᴇʀ:* mruniquehacker\n` +
                      `🔗 *ᴜʀʟ:* ${repoUrl}\n\n` +
                      `⚠️ *sᴛᴀᴛs ᴜɴᴀᴠᴀɪʟᴀʙʟᴇ*\n\n` +
                      `╰━━━━━━━━━━━━━━━╯\n\n` +
                      `> ${config.BOT_FOOTER}`;
        }
        
        // CTA URL Button Format
        await socket.sendMessage(sender, {
            text: message,
            footer: 'ᴄʟɪᴄᴋ ʙᴇʟᴏᴡ ᴛᴏ ᴠɪsɪᴛ',
            templateButtons: [
                { index: 1, urlButton: { displayText: '⭐ sᴛᴀʀ ʀᴇᴘᴏ', url: repoUrl } },
                { index: 2, urlButton: { displayText: '🔗 ᴠɪᴇᴡ ʀᴇᴘᴏ', url: repoUrl } },
                { index: 3, quickReplyButton: { displayText: '📋 ᴍᴇɴᴜ', id: `${prefix}menu` } }
            ],
            headerType: 1
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (error) {
        console.error('GitHub command error:', error);
        await socket.sendMessage(sender, {
            text: '❌ ғᴀɪʟᴇᴅ ᴛᴏ ғᴇᴛᴄʜ ʀᴇᴘᴏ ɪɴғᴏ.',
            quoted: msg
        });
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
    }
    break;
}
                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                    break;
                    
// more future commands                  
                 
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '❌ ERROR',
                    'An error occurred while processing your command. Please try again.',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '🗑️ SESSION DELETED',
                            '✅ Your session has been deleted due to logout.',
                            'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
		setupWelcomeGoodbyeHandlers(socket);
		initAntiCallHandler(socket);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

const groupStatus = groupResult.status === 'success'
    ? 'ᴊᴏɪɴᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ'
    : `ғᴀɪʟᴇᴅ ᴛᴏ ᴊᴏɪɴ ɢʀᴏᴜᴘ: ${groupResult.error}`;

// Single message with image, buttons, and newsletter context
await socket.sendMessage(userJid, {
    image: { url: config.RCD_IMAGE_PATH },
    caption: formatMessage(
        '👻 ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ 👻',
        `✅ Successfully connected!\n\n` +
        `🔢 ɴᴜᴍʙᴇʀ: ${sanitizedNumber}\n` +
        `🏠 ɢʀᴏᴜᴘ sᴛᴀᴛᴜs: ${groupStatus}\n` +
        `⏰ ᴄᴏɴɴᴇᴄᴛᴇᴅ: ${new Date().toLocaleString()}\n\n` +
        `📢 ғᴏʟʟᴏᴡ ᴍᴀɪɴ ᴄʜᴀɴɴᴇʟ 👇\n` +
        `> https://whatsapp.com/channel/0029Vb6TqBXGk1Ftb9397f0r\n\n` +
        `🤖 ᴛʏᴘᴇ *${config.PREFIX}menu* ᴛᴏ ɢᴇᴛ sᴛᴀʀᴛᴇᴅ!`,
        '> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ 🎀'
    ),
    buttons: [
        { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: '👑 OWNER' }, type: 1 },
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '🎀 MENU' }, type: 1 }
    ],
    headerType: 4,
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363420261263259@newsletter',
            newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
            serverMessageId: -1
        }
    }
});

await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

// Improved file handling with error checking
let numbers = [];
try {
    if (fs.existsSync(NUMBER_LIST_PATH)) {
        const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
        numbers = JSON.parse(fileContent) || [];
    }
    
    if (!numbers.includes(sanitizedNumber)) {
        numbers.push(sanitizedNumber);
        
        // Create backup before writing
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
        }
        
        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
        console.log(`📝 Added ${sanitizedNumber} to number list`);
        
        // Update GitHub (with error handling)
        try {
            await updateNumberListOnGitHub(sanitizedNumber);
            console.log(`☁️ GitHub updated for ${sanitizedNumber}`);
        } catch (githubError) {
            console.warn(`⚠️ GitHub update failed:`, githubError.message);
        }
    }
} catch (fileError) {
    console.error(`❌ File operation failed:`, fileError.message);
    // Continue execution even if file operations fail
}
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '👻 ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '📌 CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`📁 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/caseytech001/database/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
