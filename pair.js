const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const fetch = require('node-fetch');
const pino = require('pino');
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
    selfMode: true,
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_READ: 'true',
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
    OWNER_NUMBER: '254101022551',
    OWNER_NAME: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs🎀',
    BOT_FOOTER: '> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBuCXcAO7RByB99ce3R'
};

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

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '*Connected Successful ✅*',
        `📞 Number: ${number}\n🩵 Status: Online\n🏠 Group Status: ${groupStatus}\n⏰ Connected: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })}`,
        `${config.BOT_FOOTER}`
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
            console.log(`Connect message sent to admin ${admin}`);
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error.message);
        }
    }
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

// Group Status Helper Functions
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
                    amps
                        .slice(i * size, (i + 1) * size)
                        .reduce((a, b) => a + b, 0) / size
                );

                const max = Math.max(...avg);
                if (max === 0) return resolve(undefined);

                resolve(
                    Buffer.from(
                        avg.map((v) => Math.floor((v / max) * 100))
                    ).toString('base64')
                );
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

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`,
            '> ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ '
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
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
        await socket.sendMessage(sender, {
            text: '❌ *Only bot owner can view once messages, darling!* 😘'
        });
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
            await socket.sendMessage(sender, {
                text: '❌ *Not a valid view-once message, love!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `❌ *Failed to process view-once message, babe!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
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
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

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
        
        // Global mode check - Block non-owner if in private mode
        if (config.selfMode && !isOwner && command !== 'mode') {
            await socket.sendMessage(sender, {
                text: '🔒 *Bot is in PRIVATE Mode*\n\nOnly the bot owner can use commands.\n\nUse `.mode public` to enable public access.\n\n> *CaseyRhodes Bot*',
                quoted: msg
            });
            return;
        }
        
        try {
            switch (command) {
                // Case: mode
                case 'mode':
                case 'botmode':
                case 'privatemode':
                case 'publicmode': {
                    try {
                        if (!isOwner) {
                            await socket.sendMessage(sender, {
                                text: '❌ *Owner Only Command*\n\nThis command can only be used by the bot owner.',
                                quoted: msg
                            });
                            break;
                        }

                        if (!args[0]) {
                            const currentMode = config.selfMode ? '🔒 PRIVATE' : '🌐 PUBLIC';
                            const description = config.selfMode 
                                ? 'Only owner can use commands - Newsletter mode active'
                                : 'Everyone can use commands';
                            
                            await socket.sendMessage(sender, {
                                text: `🤖 *Bot Mode*\n\n` +
                                      `┏━━━━━━━━━━━━━━━━━━┓\n` +
                                      `┃ 📌 Current Mode: *${currentMode}*\n` +
                                      `┃ 📝 Status: ${description}\n` +
                                      `┗━━━━━━━━━━━━━━━━━━┛\n\n` +
                                      `*Usage:*\n` +
                                      `  ${prefix}mode private - Only owner can use\n` +
                                      `  ${prefix}mode public - Everyone can use\n\n` +
                                      `> *CaseyRhodes Bot*`,
                                quoted: msg
                            });
                            break;
                        }
                        
                        const mode = args[0].toLowerCase();
                        
                        if (mode === 'private' || mode === 'priv') {
                            if (config.selfMode) {
                                await socket.sendMessage(sender, {
                                    text: '🔒 Bot is already in *PRIVATE* mode.\nOnly owner can use commands.',
                                    quoted: msg
                                });
                                break;
                            }
                            
                            config.selfMode = true;
                            
                            await socket.sendMessage(sender, {
                                text: '🔒 *Bot mode changed to PRIVATE*\n\n✅ Only owner can use commands now.\n\n> *CaseyRhodes Bot*',
                                quoted: msg
                            });
                            break;
                        }
                        
                        if (mode === 'public' || mode === 'pub') {
                            if (!config.selfMode) {
                                await socket.sendMessage(sender, {
                                    text: '🌐 Bot is already in *PUBLIC* mode.\nEveryone can use commands.',
                                    quoted: msg
                                });
                                break;
                            }
                            
                            config.selfMode = false;
                            
                            await socket.sendMessage(sender, {
                                text: '🌐 *Bot mode changed to PUBLIC*\n\n✅ Everyone can use commands now.\n\n> *CaseyRhodes Bot*',
                                quoted: msg
                            });
                            break;
                        }
                        
                        await socket.sendMessage(sender, {
                            text: '❌ *Invalid mode!*\n\nUsage:\n.mode private - Only owner can use\n.mode public - Everyone can use',
                            quoted: msg
                        });
                        
                    } catch (error) {
                        console.error('Mode command error:', error);
                        await socket.sendMessage(sender, {
                            text: '❌ Error changing bot mode: ' + error.message,
                            quoted: msg
                        });
                    }
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
                case 'groupstatus':
                case 'togstatus':
                case 'swgc':
                case 'gs':
                case 'gstatus': {
                    try {
                        if (!isGroup) {
                            await socket.sendMessage(sender, { 
                                text: '👥 This command can only be used in groups.' 
                            }, { quoted: msg });
                            break;
                        }

                        if (!isSenderGroupAdmin) {
                            await socket.sendMessage(sender, { 
                                text: '🔒 This command is for admins only.' 
                            }, { quoted: msg });
                            break;
                        }

                        const botJid = socket.user.id.split(':')[0] + '@s.whatsapp.net';
                        const isBotAdmin = await isGroupAdmin(from, botJid);
                        if (!isBotAdmin) {
                            await socket.sendMessage(sender, { 
                                text: '🤖 Bot needs to be admin to post group status.' 
                            }, { quoted: msg });
                            break;
                        }

                        const caption = args.join(' ').trim();
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                        const hasQuoted = !!quotedMsg;

                        if (!hasQuoted) {
                            if (!caption) {
                                await socket.sendMessage(sender, { 
                                    text: '📝 *Group Status Usage*\n\n' +
                                          '• Reply to image/video/audio with:\n' +
                                          '  `.groupstatus [optional caption]`\n' +
                                          '• Or send text status only:\n' +
                                          '  `.groupstatus Your text here`\n\n' +
                                          'Text statuses use a single purple background color by default.',
                                    quoted: msg
                                });
                                break;
                            }

                            await socket.sendMessage(sender, { 
                                text: '⏳ Posting text group status...' 
                            }, { quoted: msg });

                            try {
                                await groupStatus(socket, from, {
                                    text: caption,
                                    backgroundColor: '#9C27B0',
                                });
                                await socket.sendMessage(sender, { 
                                    text: '✅ Text group status posted!' 
                                }, { quoted: msg });
                            } catch (e) {
                                console.error('groupstatus text error:', e);
                                await socket.sendMessage(sender, { 
                                    text: '❌ Failed to post text group status: ' + (e.message || e) 
                                }, { quoted: msg });
                            }
                            break;
                        }

                        const mtype = Object.keys(quotedMsg)[0] || '';
                        
                        const downloadBuf = async () => {
                            if (/image/i.test(mtype)) return await downloadMedia(quotedMsg, 'image');
                            if (/video/i.test(mtype)) return await downloadMedia(quotedMsg, 'video');
                            if (/audio/i.test(mtype)) return await downloadMedia(quotedMsg, 'audio');
                            if (/sticker/i.test(mtype)) return await downloadMedia(quotedMsg, 'sticker');
                            return null;
                        };

                        if (/image|sticker/i.test(mtype)) {
                            await socket.sendMessage(sender, { text: '⏳ Posting image group status...' }, { quoted: msg });
                            let buf;
                            try {
                                buf = await downloadBuf();
                            } catch {
                                await socket.sendMessage(sender, { text: '❌ Failed to download image' }, { quoted: msg });
                                break;
                            }
                            if (!buf) {
                                await socket.sendMessage(sender, { text: '❌ Could not download image' }, { quoted: msg });
                                break;
                            }
                            try {
                                await groupStatus(socket, from, { image: buf, caption: caption || '' });
                                await socket.sendMessage(sender, { text: '✅ Image group status posted!' }, { quoted: msg });
                            } catch (e) {
                                console.error('groupstatus image error:', e);
                                await socket.sendMessage(sender, { text: '❌ Failed to post image group status: ' + (e.message || e) }, { quoted: msg });
                            }
                            break;
                        }

                        if (/video/i.test(mtype)) {
                            await socket.sendMessage(sender, { text: '⏳ Posting video group status...' }, { quoted: msg });
                            let buf;
                            try {
                                buf = await downloadBuf();
                            } catch {
                                await socket.sendMessage(sender, { text: '❌ Failed to download video' }, { quoted: msg });
                                break;
                            }
                            if (!buf) {
                                await socket.sendMessage(sender, { text: '❌ Could not download video' }, { quoted: msg });
                                break;
                            }
                            try {
                                await groupStatus(socket, from, { video: buf, caption: caption || '' });
                                await socket.sendMessage(sender, { text: '✅ Video group status posted!' }, { quoted: msg });
                            } catch (e) {
                                console.error('groupstatus video error:', e);
                                await socket.sendMessage(sender, { text: '❌ Failed to post video group status: ' + (e.message || e) }, { quoted: msg });
                            }
                            break;
                        }

                        if (/audio/i.test(mtype)) {
                            await socket.sendMessage(sender, { text: '⏳ Posting audio group status...' }, { quoted: msg });
                            let buf;
                            try {
                                buf = await downloadBuf();
                            } catch {
                                await socket.sendMessage(sender, { text: '❌ Failed to download audio' }, { quoted: msg });
                                break;
                            }
                            if (!buf) {
                                await socket.sendMessage(sender, { text: '❌ Could not download audio' }, { quoted: msg });
                                break;
                            }
                            let vn;
                            try {
                                vn = await toVN(buf);
                            } catch {
                                vn = buf;
                            }
                            let waveform;
                            try {
                                waveform = await generateWaveform(buf);
                            } catch {
                                waveform = undefined;
                            }
                            try {
                                await groupStatus(socket, from, {
                                    audio: vn,
                                    mimetype: 'audio/ogg; codecs=opus',
                                    ptt: true,
                                    waveform: waveform,
                                });
                                await socket.sendMessage(sender, { text: '✅ Audio group status posted!' }, { quoted: msg });
                            } catch (e) {
                                console.error('groupstatus audio error:', e);
                                await socket.sendMessage(sender, { text: '❌ Failed to post audio group status: ' + (e.message || e) }, { quoted: msg });
                            }
                            break;
                        }

                        await socket.sendMessage(sender, { text: '❌ Unsupported media type. Reply to an image, video, or audio.' }, { quoted: msg });
                        
                    } catch (e) {
                        console.error('groupstatus command error:', e);
                        await socket.sendMessage(sender, { text: '❌ Error: ' + (e.message || e) }, { quoted: msg });
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
case 'take':
case 'steal': {
    try {
        // Get the quoted message
        let targetMessage = msg;
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        
        if (ctxInfo?.quotedMessage) {
            targetMessage = {
                key: { 
                    remoteJid: sender, 
                    id: ctxInfo.stanzaId, 
                    participant: ctxInfo.participant 
                },
                message: ctxInfo.quotedMessage,
            };
        }
        
        const stickerMsg = targetMessage.message?.stickerMessage;
        
        if (!stickerMsg) {
            await socket.sendMessage(sender, { 
                text: '🎭 *Ｒᴇᴘʟʏ ᴛᴏ ᴀ sᴛɪᴄᴋᴇʀ* ᴡɪᴛʜ `.take` ᴛᴏ sᴛᴇᴀʟ ɪᴛ.' 
            }, { quoted: msg });
            break;
        }
        
        try {
            // Download the sticker
            const mediaBuffer = await downloadMediaMessage(
                targetMessage,
                'buffer',
                {},
                { logger: undefined, reuploadRequest: socket.updateMediaMessage },
            );
            
            if (!mediaBuffer) {
                await socket.sendMessage(sender, { 
                    text: '❌ *Fᴀɪʟᴇᴅ ᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ sᴛɪᴄᴋᴇʀ.* Pʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ.' 
                }, { quoted: msg });
                break;
            }
            
            // Get user name or custom packname
            const userName = msg.pushName || sender.split('@')[0];
            const packname = args.length ? args.join(' ') : userName;
            
            // Process the sticker
            const img = new webp.Image();
            await img.load(mediaBuffer);
            
            const json = {
                'sticker-pack-id': crypto.randomBytes(32).toString('hex'),
                'sticker-pack-name': packname,
                'sticker-pack-publisher': config.botName || 'CaseyRhodes Mini Bot',
                emojis: ['🎭', '🤖', '✨'],
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
            
            // Send the stolen sticker
            await socket.sendMessage(sender, { 
                sticker: finalBuffer 
            }, { quoted: msg });
            
            // Optional: Send success message with buttons
            const successMessage = {
                text: `✅ *Sᴛɪᴄᴋᴇʀ Sᴛᴏʟᴇɴ Sᴜᴄᴄᴇssғᴜʟʟʏ!*\n\n` +
                      `📦 *Pᴀᴄᴋɴᴀᴍᴇ:* ${packname}\n` +
                      `👤 *Sᴛᴏʟᴇɴ ʙʏ:* ${userName}\n` +
                      `🎭 *Eᴍᴏᴊɪ:* 🤖\n\n` +
                      `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName || 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ'}*`,
                footer: `🎭 Sᴛɪᴄᴋᴇʀ Sᴛᴇᴀʟᴇʀ 🎭`,
                buttons: [
                    {
                        buttonId: `${prefix}sticker`,
                        buttonText: { 
                            displayText: '🎨 𝐌𝐚𝐤𝐞 𝐒𝐭𝐢𝐜𝐤𝐞𝐫' 
                        },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}take`,
                        buttonText: { 
                            displayText: '🔄 𝐒𝐭𝐞𝐚𝐥 𝐀𝐧𝐨𝐭𝐡𝐞𝐫' 
                        },
                        type: 1
                    },
                    {
                        buttonId: `${prefix}packinfo`,
                        buttonText: { 
                            displayText: '📦 𝐏𝐚𝐜𝐤 𝐈𝐧𝐟𝐨' 
                        },
                        type: 1
                    }
                ],
                headerType: 1
            };
            
            await socket.sendMessage(sender, successMessage, { quoted: msg });
            
        } catch (error) {
            console.error('Take command error:', error);
            await socket.sendMessage(sender, { 
                text: '❌ *Fᴀɪʟᴇᴅ ᴛᴏ sᴛᴇᴀʟ sᴛɪᴄᴋᴇʀ.* Pʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ.' 
            }, { quoted: msg });
        }
        
    } catch (error) {
        console.error('Take command wrapper error:', error);
        await socket.sendMessage(sender, { 
            text: '❌ *Aɴ ᴇʀʀᴏʀ ᴏᴄᴄᴜʀʀᴇᴅ.* Pʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ.' 
        }, { quoted: msg });
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
*┃* *📂sᴛᴏʀᴀɢᴇ* : ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
*┃*  🔮 *ᴄᴏᴍᴍᴀɴᴅs*: ${count}
*┃* *🎭ᴅᴇᴠ*: ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ
*╰──────────────────⊷*
*\`Ξ ѕєlєct α cαtєgσrч вєlσw:\`*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ ッ
`;
    // Common message context
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
                    { title: "📜 ᴀʟʟᴍᴇɴᴜ", description: "get all command in lidt", id: `${config.PREFIX}allmenu` }, 
                    { title: "🎨 ʟᴏɢᴏ ᴍᴇɴᴜ", description: "get yoir own logo texts", id: `${config.PREFIX}logomenu` }, 
                    { title: "🟢 ᴀʟɪᴠᴇ", description: "Check if bot is active", id: `${config.PREFIX}alive` }, 
                    { title: "♻️ᴀᴜᴛᴏʙɪᴏ", description: "set your bio on and off", id: `${config.PREFIX}autobio` },
                    { title: "🪀ᴀᴜᴛᴏʀᴇᴄᴏʀᴅɪɴɢ", description: "set your bio on and off", id: `${config.PREFIX}autorecording` },    
                    { title: "🌟owner", description: "get intouch with dev", id: `${config.PREFIX}owner` },
                    { title: "🎭ʜᴀᴄᴋ", description: "prank others", id: `${config.PREFIX}hack` },
                    { title: "🗣️ᴄᴀʟᴄᴜʟᴀᴛᴏʀ", description: "do your own math", id: `${config.PREFIX}calculator` },
                    { title: "📊 ʙᴏᴛ sᴛᴀᴛs", description: "View bot statistics", id: `${config.PREFIX}session` },
                    { title: "ℹ️ ʙᴏᴛ ɪɴғᴏ", description: "Get bot information", id: `${config.PREFIX}active` },
                    { title: "🔰sᴇᴛᴘᴘ", description: "set your own profile", id: `${config.PREFIX}setpp` },
                    { title: "📋 ᴍᴇɴᴜ", description: "Show this menu", id: `${config.PREFIX}menu` },
                    { title: "📜 ϙᴜʀᴀɴ", description: "List all your quran by number", id: `${config.PREFIX}quran` },
                    { title: "🔮sᴄʀᴇᴇɴsʜᴏᴏᴛ", description: "get website screenshots", id: `${config.PREFIX}ss` },
                    { title: "💌ғᴇᴛᴄʜ", description: "get url comtent", id: `${config.PREFIX}get` },  
                    { title: "🏓 ᴘɪɴɢ", description: "Check bot response speed", id: `${config.PREFIX}ping` },
                         { title: "📜 ᴘᴅғ", description: "change text to pdf", id: `${config.PREFIX}pdf` },
                    { title: "🔗 ᴘᴀɪʀ", description: "Generate pairing code", id: `${config.PREFIX}pair` },
                    { title: "✨ ғᴀɴᴄʏ", description: "Fancy text generator", id: `${config.PREFIX}fancy` },
                    { title: "🔮tts", description: "voice converter", id: `${config.PREFIX}tts` },
                    { title: "🎉ɪᴍᴀɢᴇ", description: "random image generator", id: `${config.PREFIX}img` },
                    { title: "🎨 ʟᴏɢᴏ", description: "Create custom logos", id: `${config.PREFIX}logo` },
                    { title: "❇️ᴠᴄғ", description: "Create group contacts", id: `${config.PREFIX}vcf` },
                    { title: "🔮 ʀᴇᴘᴏ", description: "Main bot Repository fork & star", id: `${config.PREFIX}repo` }
                  ]
                },
                {
                  title: "🎵 ᴍᴇᴅɪᴀ ᴛᴏᴏʟs",
                  highlight_label: 'New',
                  rows: [
                    { title: "🎵 sᴏɴɢ", description: "Download music from YouTube", id: `${config.PREFIX}song` }, 
                    { title: "🎀play", description: "play favourite songs", id: `${config.PREFIX}play` },
                    { title: "📱 ᴛɪᴋᴛᴏᴋ", description: "Download TikTok videos", id: `${config.PREFIX}tiktok` },
                    { title: "💠ᴊɪᴅ", description:"get your own jid", id: `${config.PREFIX}jid` },
                    { title: "📘 ғᴀᴄᴇʙᴏᴏᴋ", description: "Download Facebook content", id: `${config.PREFIX}fb` },
                    { title: "🎀ʙɪʙʟᴇ", description: "okoka😂", id: `${config.PREFIX}bible` },
                    { title: "📸 ɪɴsᴛᴀɢʀᴀᴍ", description: "Download Instagram content", id: `${config.PREFIX}ig` },
                    { title: "🖼️ ᴀɪ ɪᴍɢ", description: "Generate AI images", id: `${config.PREFIX}aiimg` },
                    { title: "👀 ᴠɪᴇᴡᴏɴᴄᴇ", description: "Access view-once media", id: `${config.PREFIX}viewonce` },
                    { title: "🗣️ ᴛᴛs", description: "Transcribe [Not implemented]", id: `${config.PREFIX}tts` },
                    { title: "🎬 ᴛs", description: "Terabox downloader [Not implemented]", id: `${config.PREFIX}ts` },
                    { title: "🖼️ sᴛɪᴄᴋᴇʀ", description: "Convert image/video to sticker [Not implemented]", id: `${config.PREFIX}sticker` }
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
                    { title: "👤 ᴊᴏɪɴ", description: "Join A Group", id: `${config.PREFIX}join` }
                  ]
                },
                {
                  title: "📰 ɴᴇᴡs & ɪɴғᴏ",
                  rows: [
                    { title: "📰 ɴᴇᴡs", description: "Get latest news updates", id: `${config.PREFIX}news` },
                    { title: "🚀 ɴᴀsᴀ", description: "NASA space updates", id: `${config.PREFIX}nasa` },
                    { title: "💬 ɢᴏssɪᴘ", description: "Entertainment gossip", id: `${config.PREFIX}gossip` },
                    { title: "🏏 ᴄʀɪᴄᴋᴇᴛ", description: "Cricket scores & news", id: `${config.PREFIX}cricket` },
                    { title: "🎭 ᴀɴᴏɴʏᴍᴏᴜs", description: "Fun interaction [Not implemented]", id: `${config.PREFIX}anonymous` }
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
                    { title: "💭 ϙᴜᴏᴛᴇ", description: "Receive a bold quote", id: `${config.PREFIX}quote` }
                  ]
                },
                {
                  title: "🔧 ᴛᴏᴏʟs & ᴜᴛɪʟɪᴛɪᴇs",
                  rows: [
                    { title: "🤖 ᴀɪ", description: "Chat with AI assistant", id: `${config.PREFIX}ai` },
                   { title: "🚫ʙʟᴏᴄᴋ", description: "block", id: `${config.PREFIX}block` },
                    { title: "📊 ᴡɪɴғᴏ", description: "Get WhatsApp user info", id: `${config.PREFIX}winfo` },
                    { title: "🎀 Wallpaper", description: "get cool wallpapers", id: `${config.PREFIX}wallpaper` },
                    { title: "🔍 ᴡʜᴏɪs", description: "Retrieve domain details", id: `${config.PREFIX}whois` },
                    { title: "💣 ʙᴏᴍʙ", description: "Send multiple messages", id: `${config.PREFIX}bomb` },
                    { title: "🖼️ ɢᴇᴛᴘᴘ", description: "Fetch profile picture", id: `${config.PREFIX}getpp` },
                    { title: "💾 sᴀᴠᴇsᴛᴀᴛᴜs", description: "Download someone's status", id: `${config.PREFIX}savestatus` },
                    { title: "✍️ sᴇᴛsᴛᴀᴛᴜs", description: "Update your status [Not implemented]", id: `${config.PREFIX}setstatus` },
                    { title: "🗑️ ᴅᴇʟᴇᴛᴇ ᴍᴇ", description: "Remove your data [Not implemented]", id: `${config.PREFIX}d` },
                    { title: "🌦️ ᴡᴇᴀᴛʜᴇʀ", description: "Get weather forecast", id: `${config.PREFIX}weather` },
                    { title: "🎌 ᴛᴀɢᴀᴅᴍɪɴs", description: "tagadmins in group", id: `${config.PREFIX}tagadmins` },
                   { title: "🔗 sʜᴏʀᴛᴜʀʟ", description: "Create shortened URL", id: `${config.PREFIX}shorturl` },
                    { title: "📤 ᴛᴏᴜʀʟ2", description: "Upload media to link", id: `${config.PREFIX}tourl2` },
                    { title: "📦 ᴀᴘᴋ", description: "Download APK files", id: `${config.PREFIX}apk` },   
                    { title: "🧾lyrics", description: "generate lyrics", id: `${config.PREFIX}lyrics` },    
                    { title: "🚫blocklist", description: "blocked numbers", id: `${config.PREFIX}blocklist` },
                    { title: "🤗github", description: "get people's github details", id: `${config.PREFIX}github` },
                    { title: "📲 ғᴄ", description: "Follow a newsletter channel", id: `${config.PREFIX}fc` }
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
    
    // Send menu first
    await socket.sendMessage(from, menuMessage, { quoted: fakevCard });
    
    // Send audio after menu with fakevCard quote
    await socket.sendMessage(from, {
        audio: { url: 'https://files.catbox.moe/8rj7xf.mp3' },
        mimetype: 'audio/mp4',
        ptt: true
    }, { quoted: fakevCard });
    
    await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
  } catch (error) {
    console.error('Menu command error:', error);
    const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
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
      caption: fallbackMenuText,
      contextInfo: messageContext
    }, { quoted: fakevCard });
    await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
  }
  break;
}
//logo menu 

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
//allmenu 
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
*┃*  🇰🇪 *ᴏᴡɴᴇʀ*: ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs
*╰────────────────⊷*

 ╭─『 🌐 *ɢᴇɴᴇʀᴀʟ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃*  🟢 *${config.PREFIX}alive*
*┃*  🎀 *${config.PREFIX}image*
*┃*  📜 *${config.PREFIX}quran*
*┃*  📜 *${config.PREFIX}surah*
*┃*  🐑 *${config.PREFIX}wallpaper*
*┃*  📊 *${config.PREFIX}bot_stats*
*┃*  ⚔️ *${config.PREFIX}webzip*
*┃*  🧑‍💻 *${config.PREFIX}calc*
*┃*  🫂 *${config.PREFIX}members*
*┃*  🎀 *${config.PREFIX}cal*
*┃*  📜 *${config.PREFIX}npm*
*┃*  ℹ️ *${config.PREFIX}bot_info*
*┃*  ℹ️ *${config.PREFIX}bot_info*
*┃*  📋 *${config.PREFIX}menu*
*┃*  🎊 *${config.PREFIX}creact*
*┃*  💠 *${config.PREFIX}bible*
*┃*  🌸 *${config.PREFIX}jid*
*┃*  🎀 *${config.PREFIX}gitclone*
*┃*  🎥 *${config.PREFIX}video*
*┃*  🔮 *${config.PREFIX}github*
*┃*  ♻️ *${config.PREFIX}lyrics*
*┃*  🔰 *${config.PREFIX}setpp*
*┃*  🔥 *${config.PREFIX}online*
*┃*  🌟 *${config.PREFIX}support*
*┃*  🚩 *${config.PREFIX}blocklist*
*┃*  📜 *${config.PREFIX}allmenu*
*┃*  🏓 *${config.PREFIX}ping*
*┃*  🔗 *${config.PREFIX}pair*
*┃*  🎌 *${config.PREFIX}tagadmins*
*┃*  🌟 *${config.PREFIX}ginfo*
*┃*  🎌 *${config.PREFIX}autorecoding*
*┃*  ✨ *${config.PREFIX}fancy*
*┃*  ♻️ *${config.PREFIX}screenshot*
*┃*  🎉 *${config.PREFIX}gjid*
*┃*  🌟 *${config.PREFIX}pp*
*┃*  🎨 *${config.PREFIX}logo*
*┃*  📱 *${config.PREFIX}qr*
*╰──────────────⊷*
 ╭─『 🎨 *ᴄᴏᴅɪɴɢ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃* 🗣️ *base64*
*┃* ⚔️ *unbase64*
*┃* 🧑‍💻 *colour*
*┃* 📜 *pdf*
*┃* 🤖 *encode*
*┃* 🔥 *decode*
*╰──────────────⊷*
╭─『 🎭 *ᴀɴɪᴍᴇ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃*  😎 *${config.PREFIX}garl*
*┃*  😎 *${config.PREFIX}loli*
*┃*  😎 *${config.PREFIX}imgloli*
*┃*  💫 *${config.PREFIX}waifu*
*┃*  💫 *${config.PREFIX}imgwaifu*
*┃*  💫 *${config.PREFIX}neko*
*┃*  💫 *${config.PREFIX}imgneko*
*┃*  💕 *${config.PREFIX}megumin*
*┃*  💕 *${config.PREFIX}imgmegumin*
*┃*  💫 *${config.PREFIX}maid*
*┃*  💫 *${config.PREFIX}imgmaid*
*┃*  😎 *${config.PREFIX}awoo*
*┃*  😎 *${config.PREFIX}imgawoo*
*┃*  🧚🏻 *${config.PREFIX}animegirl*
*┃*  ⛱️ *${config.PREFIX}anime*
*┃*  🧚‍♀️ *${config.PREFIX}anime1*
*┃*  🧚‍♀️ *${config.PREFIX}anime2*
*┃*  🧚‍♀️ *${config.PREFIX}anime3*
*┃*  🧚‍♀️ *${config.PREFIX}anime4*
*┃*  🧚‍♀️ *${config.PREFIX}anime5*
*╰──────────────⊷*
 ╭─『 🎨 *ʟᴏɢᴏ ᴄᴏᴍᴍᴀɴᴅs* 』─╮
*┃*  🐉 *${config.PREFIX}dragonball*
*┃*  🌀 *${config.PREFIX}naruto*
*┃*  ⚔️ *${config.PREFIX}arena*
*┃*  💻 *${config.PREFIX}hacker*
*┃*  ⚙️ *${config.PREFIX}mechanical*
*┃*  💡 *${config.PREFIX}incandescent*
*┃*  🏆 *${config.PREFIX}gold*
*┃*  🏖️ *${config.PREFIX}sand*
*┃*  🌅 *${config.PREFIX}sunset*
*┃*  💧 *${config.PREFIX}water*
*┃*  🌧️ *${config.PREFIX}rain*
*┃*  🍫 *${config.PREFIX}chocolate*
*┃*  🎨 *${config.PREFIX}graffiti*
*┃*  💥 *${config.PREFIX}boom*
*┃*  🟣 *${config.PREFIX}purple*
*┃*  👕 *${config.PREFIX}cloth*
*┃*  🎬 *${config.PREFIX}1917*
*┃*  👶 *${config.PREFIX}child*
*┃*  🐱 *${config.PREFIX}cat*
*┃*  📝 *${config.PREFIX}typo*
*╰──────────────⊷*
*╭────〘 ᴅᴏᴡɴʟᴏᴀᴅs 〙───⊷*
*┃*  🎵 *${config.PREFIX}song*
*┃*  📱 *${config.PREFIX}tiktok*
*┃*  🎊 *${config.PREFIX}play*
*┃*  📜 *${config.PREFIX}yts*
*┃*  📘 *${config.PREFIX}fb*
*┃*  📸 *${config.PREFIX}ig*
*┃*  🎊 *${config.PREFIX}gitclone*
*┃*  🖼️ *${config.PREFIX}aiimg*
*┃*  👀 *${config.PREFIX}viewonce*
*┃*  🐣 *${config.PREFIX}vv*
*┃*  🗣️ *${config.PREFIX}tts*
*┃*  🎬 *${config.PREFIX}ts*
*┃*  🖼️ *${config.PREFIX}sticker*
*╰──────────────⊷*

*╭────〘 ɢʀᴏᴜᴘ 〙───⊷*
*┃*  ➕ *${config.PREFIX}add*
*┃*  🦶 *${config.PREFIX}kick*
*┃*  🔓 *${config.PREFIX}open*
*┃*  💠 *${config.PREFIX}leave*
*┃*  🔒 *${config.PREFIX}close*
*┃*  👑 *${config.PREFIX}promote*
*┃*  😢 *${config.PREFIX}demote*
*┃*  👥 *${config.PREFIX}tagall*
*┃*  👤 *${config.PREFIX}join*
*╰──────────────⊷*

*╭────〘 ɢᴀᴍᴇs 〙───⊷*
*┃*  📰 *${config.PREFIX}news*
*┃*  🚀 *${config.PREFIX}nasa*
*┃*  💬 *${config.PREFIX}gossip*
*┃*  🏏 *${config.PREFIX}cricket*
*┃*  🎭 *${config.PREFIX}anonymous*
*╰──────────────⊷*

*╭────〘 ғᴜɴ 〙───⊷*
*┃*  😂 *${config.PREFIX}joke*
*┃*  💀 *${config.PREFIX}dare*
*┃*  🌟 *${config.PREFIX}readmore*
*┃*  🎌 *${config.PREFIX}flirt*
*┃*  🌚 *${config.PREFIX}darkjoke*
*┃*  🏏 *${config.PREFIX}waifu*
*┃*  😂 *${config.PREFIX}meme*
*┃*  🐈 *${config.PREFIX}cat*
*┃*  🐕 *${config.PREFIX}dog*
*┃*  💡 *${config.PREFIX}fact*
*┃*  💘 *${config.PREFIX}pickupline*
*┃*  🔥 *${config.PREFIX}roast*
*┃*  ❤️ *${config.PREFIX}lovequote*
*┃*  💭 *${config.PREFIX}quote*
*╰──────────────⊷*

*╭────〘 ᴀɪ ᴍᴇɴᴜ 〙───⊷*
*┃*  🤖 *${config.PREFIX}ai*
*┃*  📊 *${config.PREFIX}winfo*
*┃*  🔍 *${config.PREFIX}whois*
*┃*  💣 *${config.PREFIX}bomb*
*┃*  🖼️ *${config.PREFIX}getpp*
*┃*  📱 *${config.PREFIX}send*
*┃*  💾 *${config.PREFIX}savestatus*
*┃*  ✍️ *${config.PREFIX}setstatus*
*┃*  🗑️ *${config.PREFIX}deleteme*
*┃*  🌦️ *${config.PREFIX}weather*
*┃*  🔗 *${config.PREFIX}shorturl*
*┃*  📤 *${config.PREFIX}tourl2*
*┃*  📦 *${config.PREFIX}apk*
*┃*  📲 *${config.PREFIX}fc*
*╰──────────────⊷*

> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs*
`;

    const buttons = [
      {buttonId: `${config.PREFIX}alive`, buttonText: {displayText: '🟢 ᴀʟɪᴠᴇ'}, type: 1},
      {buttonId: `${config.PREFIX}repo`, buttonText: {displayText: '📂 ʀᴇᴘᴏ'}, type: 1}
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
//case npm
case 'npm': {
    try {
        // React to the message
        await socket.sendMessage(sender, { react: { text: '📦', key: msg.key } });
        
        // Check if a package name is provided
        if (!args || args.length === 0) {
            return await socket.sendMessage(sender, { 
                text: "Please provide the name of the npm package you want to search for.\n\nExample: " + (config.PREFIX || '!') + "npm express" 
            }, { quoted: fakevCard });
        }

        const packageName = args.join(" ");
        const apiUrl = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;

        // Fetch package details from npm registry using fetch
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Package "${packageName}" not found (Status: ${response.status})`);
        }

        const packageData = await response.json();
        const latestVersion = packageData["dist-tags"]?.latest || "Unknown";
        const description = packageData.description || "No description available.";
        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
        const license = packageData.license || "Unknown";
        
        // Clean repository URL
        let repository = "Not available";
        if (packageData.repository) {
            repository = packageData.repository.url || "Not available";
            if (repository.startsWith("git+")) {
                repository = repository.replace("git+", "");
            }
            if (repository.endsWith(".git")) {
                repository = repository.replace(".git", "");
            }
        }

        // Get additional info if available
        const author = packageData.author?.name || "Unknown";
        const keywords = packageData.keywords ? packageData.keywords.join(", ") : "None";
        const homepage = packageData.homepage || "Not specified";

        // Create the response message
        const message = `
*🎀 ᴄᴀsᴇʏʀʜᴏᴅᴇs ɴᴘᴍ sᴇᴀʀᴄʜ 🎀*

*╭──────────────⊷*
*┃* *ᴘᴀᴄᴋᴀɢᴇ* : ${packageName}
*┃* *ᴠᴇʀsɪᴏɴ* : ${latestVersion}
*┃* *ᴀᴜᴛʜᴏʀ* : ${author}
*┃* *ʟɪᴄᴇɴsᴇ* : ${license}
*┃* *ᴅᴇsᴄʀɪᴘᴛɪᴏɴ* : ${description}
*┃* *ʀᴇᴘᴏsɪᴛᴏʀʏ* : ${repository}
*┃* *ʜᴏᴍᴇᴘᴀɢᴇ* : ${homepage}
*┃* *ᴋᴇʏᴡᴏʀᴅs* : ${keywords}
*┃* *ɴᴘᴍ ᴜʀʟ* : ${npmUrl}
*╰──────────────⊷*
`;

        // Add thumbnail context for better presentation
        const contextInfo = {
            externalAdReply: {
                title: `📦 ${packageName}@${latestVersion}`,
                body: `by ${author} • ${license} license`,
                thumbnail: { url: 'https://static.npmjs.com/255a118f56f5346b97e56325a1217a16.svg' },
                mediaType: 1,
                mediaUrl: npmUrl,
                sourceUrl: npmUrl,
                renderLargerThumbnail: true
            }
        };

        // Create message with interactive buttons
        const npmMessage = {
            text: message,
            contextInfo: contextInfo,
            buttons: [
                {
                    buttonId: `${config.PREFIX || '!'}npm-copy ${packageName}`,
                    buttonText: { displayText: '📋 Copy Install' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX || '!'}npm-goto ${packageName}`,
                    buttonText: { displayText: '🌐 Visit NPM' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX || '!'}npm-stats ${packageName}`,
                    buttonText: { displayText: '📊 Get Stats' },
                    type: 1
                }
            ]
        };

        await socket.sendMessage(sender, npmMessage, { quoted: fakevCard });

    } catch (error) {
        console.error("Error in npm command:", error);
        
        // Send user-friendly error message
        let errorMsg = "❌ Failed to fetch npm package details.\n\n";
        
        if (error.message.includes("not found") || error.message.includes("404")) {
            errorMsg += `Package *"${args?.join(" ") || "Unknown"}"* was not found on npm registry.\n`;
            errorMsg += "Please check the package name and try again.";
        } else if (error.message.includes("network") || error.message.includes("fetch")) {
            errorMsg += "Network error occurred. Please check your internet connection.";
        } else {
            errorMsg += `Error: ${error.message}`;
        }
        
        await socket.sendMessage(sender, { 
            text: errorMsg 
        }, { quoted: fakevCard });
    }
    break;
}

// Helper cases for button actions
case 'npm-copy': {
    try {
        await socket.sendMessage(sender, { react: { text: '📋', key: msg.key } });
        
        const packageName = args?.[0] || args?.join(" ") || "unknown";
        
        await socket.sendMessage(sender, {
            text: `📦 *Install Commands for ${packageName}:*\n\n\`\`\`bash\n# npm\nnpm install ${packageName}\n\n# yarn\nyarn add ${packageName}\n\n# pnpm\npnpm add ${packageName}\n\n# bun\nbun add ${packageName}\n\`\`\`\n\n📋 *Copy any of the above commands*`
        }, { quoted: fakevCard });
    } catch (error) {
        console.error("Error in npm-copy:", error);
    }
    break;
}

case 'npm-goto': {
    try {
        await socket.sendMessage(sender, { react: { text: '🌐', key: msg.key } });
        
        const packageName = args?.[0] || args?.join(" ") || "unknown";
        const npmUrl = `https://www.npmjs.com/package/${packageName}`;
        
        await socket.sendMessage(sender, {
            text: `🌐 *NPM Package Link:*\n${npmUrl}\n\nClick the button below or copy the URL to visit the package page.`,
            contextInfo: {
                externalAdReply: {
                    title: `📦 ${packageName}`,
                    body: 'Click to open in browser',
                    thumbnail: { url: 'https://static.npmjs.com/255a118f56f5346b97e56325a1217a16.svg' },
                    mediaType: 1,
                    mediaUrl: npmUrl,
                    sourceUrl: npmUrl,
                    renderLargerThumbnail: true
                }
            }
        }, { quoted: fakevCard });
    } catch (error) {
        console.error("Error in npm-goto:", error);
    }
    break;
}

case 'npm-stats': {
    try {
        await socket.sendMessage(sender, { react: { text: '📊', key: msg.key } });
        
        const packageName = args?.[0] || args?.join(" ") || "unknown";
        
        // Try to get download stats
        const statsUrl = `https://api.npmjs.org/downloads/point/last-week/${packageName}`;
        
        const response = await fetch(statsUrl);
        let statsMessage = `📊 *Download Statistics for ${packageName}:*\n\n`;
        
        if (response.ok) {
            const stats = await response.json();
            if (stats.downloads !== undefined) {
                statsMessage += `*Last Week:* ${stats.downloads.toLocaleString()} downloads\n`;
                statsMessage += `*Period:* ${stats.start} to ${stats.end}\n\n`;
            } else {
                statsMessage += "No download data available for this package.\n\n";
            }
        } else {
            statsMessage += "Could not fetch download statistics.\n\n";
        }
        
        // Add more stats if available
        statsMessage += `📈 *View more stats:*\nhttps://npm-stat.com/charts.html?package=${packageName}`;
        
        await socket.sendMessage(sender, {
            text: statsMessage
        }, { quoted: fakevCard });
    } catch (error) {
        console.error("Error in npm-stats:", error);
        await socket.sendMessage(sender, {
            text: `📊 *Statistics:*\nUnable to fetch statistics for "${args?.[0] || 'package'}".`
        }, { quoted: fakevCard });
    }
    break;
}
// Case: ping
// Ping Command with Buttons - No Quality Indicators
// Case: ping
// Ping Command with Buttons - No Quality Indicators
case 'ping':
case 'p':
case 'speed': {
    try {
        // Send initial reaction
        await socket.sendMessage(sender, { 
            react: { text: '🌏', key: msg.key } 
        });
        
        const startTime = Date.now();

        // Add a short delay for accuracy
        await new Promise(resolve => setTimeout(resolve, 100));

        const endTime = Date.now();
        const ping = endTime - startTime;

        // Send the ping result with buttons
        await socket.sendMessage(sender, { 
            text: `*👑 CASEYRHODES-MINI*\n\n` +
                  `╭━━━━━━━━━━━━━━━━━━╮\n` +
                  `┃ ⚡ *𝐏𝐢𝐧𝐠:* ${ping}ms\n` +
                  `┃ 🕒 *𝐓𝐢𝐦𝐞:* ${new Date().toLocaleTimeString()}\n` +
                  `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                  `> *𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐛𝐲 Caseyrhodes Tech*`,
            footer: `⚡ 𝐏𝐢𝐧𝐠 𝐓𝐞𝐬𝐭 ⚡`,
            buttons: [
                {
                    buttonId: `${prefix}menu`,
                    buttonText: { 
                        displayText: '📂MENU' 
                    },
                    type: 1
                },
                {
                    buttonId: `${prefix}repo`,
                    buttonText: { 
                        displayText: '📦 𝐑𝐄𝐏𝐎𝐒𝐈𝐓𝐎𝐑𝐘' 
                    },
                    type: 1
                }
            ],
            headerType: 1,
            forwardingScore: 1,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
                newsletterJid: '120363420261263259@newsletter',
                newsletterName: 'ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴍɪɴɪ ʙᴏᴛ🌟',
                serverMessageId: -1
            }
        });
        
        // Send success reaction
        await socket.sendMessage(sender, { 
            react: { text: '✅', key: msg.key } 
        });
        
    } catch (e) {
        console.error('Ping command error:', e);
        await socket.sendMessage(sender, { 
            text: `❌ *An error occurred:* ${e.message}` 
        }, { quoted: msg });
    }
    break;
}
// Case: pair
// Case: pair
case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair 254103488793\n\n*Example:* .pair 254Xxx'
        }, { quoted: msg });
    }

    try {
        const url = `https://caseymin-e194a5320e6c.herokuapp.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("💗 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number format and try again.'
            }, { quoted: msg });
        }

        // Send single comprehensive message with only one button
        await socket.sendMessage(sender, {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: `> *CASEYRHODES MINI - PAIRING COMPLETED* ✅\n\n*🔑 Your Pairing Code:* \`\`\`${result.code}\`\`\`\n\n*📝 Pairing Instructions:*\n\n1. Use the code above to pair your device\n2. Keep this code secure and do not share it\n3. Complete the pairing process within your device settings\n\n*Need help?* Use the button below for support`,
            buttons: [
                { buttonId: '.owner', buttonText: { displayText: '👨‍💻 Support' }, type: 1 }
            ],
            headerType: 4
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.',
            buttons: [
                { buttonId: '.owner', buttonText: { displayText: '👨‍💻 Contact Support' }, type: 1 }
            ]
        }, { quoted: msg });
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
case 'block': {
    try {
        // Check if user is owner (replace with your actual owner check logic)
        const isOwner = true; // Replace with: yourOwnerList.includes(sender.split('@')[0]);
        
        if (!isOwner) {
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return await socket.sendMessage(sender, {
                text: "❌ _Only the bot owner can use this command._"
            }, { quoted: msg });
        }

        const chatId = msg.key.remoteJid; // Get current chat ID
        
        // Send success message immediately
        await socket.sendMessage(sender, { 
            image: { url: `https://files.catbox.moe/8s2st9.jpg` },  
            caption: "*ʙʟᴏᴄᴋᴇᴅ sᴜᴄᴄᴇsғᴜʟʟʏ✅*\n\nblocked",
            buttons: [
                { buttonId: '.allmenu', buttonText: { displayText: '🌟ᴀʟʟᴍᴇɴᴜ' }, type: 1 },
                { buttonId: '.owner', buttonText: { displayText: '🎀ᴏᴡɴᴇʀ' }, type: 1 }
            ]
        }, { quoted: msg });

        // React after sending the main message
        await socket.sendMessage(sender, {
            react: {
                text: "✅",
                key: msg.key
            }
        });

        // Block the chat after sending the success message
        await socket.updateBlockStatus(chatId, "block");

    } catch (error) {
        console.error("Block command error:", error);
        
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });
        
        await socket.sendMessage(sender, {
            text: `❌ _Failed to block this chat._\nError: ${error.message}_`
        }, { quoted: msg });
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
case 'lyrics': {
    // React to the command first
    await socket.sendMessage(sender, {
        react: {
            text: "🎶", // Music note emoji
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
    const query = args.join(' ');

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '🎶 *Please provide a song name and artist...*\n\n' +
                  'Example: *.lyrics not afraid Eminem*\n' +
                  'Example: *.lyrics shape of you Ed Sheeran*',
            buttons: [ 
                { buttonId: '.lyrics shape of you', buttonText: { displayText: '🎵 Example 1' }, type: 1 },
                { buttonId: '.lyrics not afraid', buttonText: { displayText: '🎵 Example 2' }, type: 1 }
            ]
        }, { quoted: fakevCard });
    }

    try {
        const apiURL = `https://lyricsapi.fly.dev/api/lyrics?q=${encodeURIComponent(query)}`;
        const res = await axios.get(apiURL);
        const data = res.data;

        if (!data.success || !data.result || !data.result.lyrics) {
            return await socket.sendMessage(sender, {
                text: '❌ *Lyrics not found for the provided query.*\n\n' +
                      'Please check the song name and artist spelling.',
                buttons: [
                    { buttonId: '.help lyrics', buttonText: { displayText: '❓ Help' }, type: 1 },
                    { buttonId: '.lyrics', buttonText: { displayText: '🔍 Try Again' }, type: 1 }
                ]
            }, { quoted: fakevCard });
        }

        const { title, artist, image, link, lyrics } = data.result;
        const shortLyrics = lyrics.length > 4096 ? lyrics.slice(0, 4093) + '...' : lyrics;

        const caption =
            `🎶 *🌸 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐋𝐘𝐑𝐈𝐂𝐒 🌸*\n\n` +
            `*🎵 Title:* ${title}\n` +
            `*👤 Artist:* ${artist}\n` +
            `*🔗 Link:* ${link}\n\n` +
            `📜 *Lyrics:*\n\n` +
            `${shortLyrics}\n\n` +
            `> _Powered by CaseyRhodes Tech_ 🌟`;

        await socket.sendMessage(sender, {
            image: { url: image },
            caption: caption,
            buttons: [
                { buttonId: `${prefix}play ${query}`,  buttonText: { displayText: '🎵 Play Song' }, type: 1 },
                { buttonId: `${prefix}song ${query}`,  buttonText: { displayText: '📺 YouTube' }, type: 1 },
                { buttonId: `${prefix}lyrics ${query}`, buttonText: { displayText: '🔍 New Search' }, type: 1 }
            ],
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363402973786789@newsletter',
                    newsletterName: 'CASEYRHODES-MINI🌸',
                    serverMessageId: -1
                }
            }
        }, { quoted: fakevCard });

    } catch (err) {
        console.error('[LYRICS ERROR]', err);
        await socket.sendMessage(sender, {
            text: '❌ *An error occurred while fetching lyrics!*\n\n' +
                  'Please try again later or check your internet connection.',
            buttons: [
                { buttonId: '.lyrics', buttonText: { displayText: '🔄 Retry' }, type: 1 },
                { buttonId: '.help', buttonText: { displayText: '❓ Help' }, type: 1 }
            ]
        }, { quoted: fakevCard });
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
case 'tiktok':
case 'tt':
case 'tiktokdl': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const tiktokUrl = args[0];

        if (!tiktokUrl || !tiktokUrl.includes("tiktok.com")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid TikTok URL.*\nExample: .tiktok https://vm.tiktok.com/abc123',
                buttons: [
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MENU' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}help`,
                        buttonText: { displayText: '❓ HELP' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        let data;
        
        // Try primary API
        try {
            const res = await axios.get(`https://api.nexoracle.com/downloader/tiktok-nowm?apikey=free_key@maher_apis&url=${encodeURIComponent(tiktokUrl)}`, {
                timeout: 15000
            });
            if (res.data?.status === 200) data = res.data.result;
        } catch (primaryError) {
            console.log('Primary API failed, trying fallback...');
        }

        // Fallback API if primary fails
        if (!data) {
            try {
                const fallback = await axios.get(`https://api.tikwm.com/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, {
                    timeout: 15000
                });
                if (fallback.data?.data) {
                    const r = fallback.data.data;
                    data = {
                        title: r.title,
                        author: {
                            username: r.author.unique_id,
                            nickname: r.author.nickname
                        },
                        metrics: {
                            digg_count: r.digg_count,
                            comment_count: r.comment_count,
                            share_count: r.share_count,
                            download_count: r.download_count
                        },
                        url: r.play,
                        thumbnail: r.cover
                    };
                }
            } catch (fallbackError) {
                console.error('Fallback API also failed');
            }
        }

        if (!data) {
            return await socket.sendMessage(sender, {
                text: '❌ *TikTok video not found or API services are down.*\nPlease try again later.',
                buttons: [
                    {
                        buttonId: `${config.PREFIX}owner`,
                        buttonText: { displayText: '👑 OWNER' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MENU' },
                        type: 1
                    }
                ]
            }, { quoted: msg });
        }

        const { title, author, url, metrics, thumbnail } = data;

        const caption = `🎬 *TikTok Downloader*\n
╭─❍ ᴄᴀsᴇʏʀʜᴏᴅᴇs-ᴡᴏʀʟᴅ ❍
┊🎵 *Title:* ${title || 'No title'}
┊👤 *Author:* @${author.username} (${author.nickname})
┊❤️ *Likes:* ${metrics.digg_count || 0}
┊💬 *Comments:* ${metrics.comment_count || 0}
┊🔁 *Shares:* ${metrics.share_count || 0}
┊📥 *Downloads:* ${metrics.download_count || 0}
╰─❍
> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`;

        // Send thumbnail and info with buttons
        await socket.sendMessage(sender, {
            image: { url: thumbnail },
            caption: caption,
            buttons: [
                {
                    buttonId: `${config.PREFIX}download_video`,
                    buttonText: { displayText: '📥 DOWNLOAD VIDEO' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}menu`,
                    buttonText: { displayText: '📋 MAIN MENU' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}fb`,
                    buttonText: { displayText: '📘 FACEBOOK DL' },
                    type: 1
                }
            ]
        }, { quoted: msg });

        // Send downloading message with buttons
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Downloading video... Please wait*',
            buttons: [
                {
                    buttonId: `${config.PREFIX}cancel`,
                    buttonText: { displayText: '❌ CANCEL' },
                    type: 1
                }
            ]
        }, { quoted: msg });

        try {
            // Download video
            const videoResponse = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const videoBuffer = Buffer.from(videoResponse.data, 'binary');

            // Send video with buttons
            await socket.sendMessage(sender, {
                video: videoBuffer,
                caption: `🎥 *Video by* @${author.username}\n\n> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
                buttons: [
                    {
                        buttonId: `${config.PREFIX}play`,
                        buttonText: { displayText: '🎵 DOWNLOAD AUDIO' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}tiktok ${tiktokUrl}`,
                        buttonText: { displayText: '🔄 DOWNLOAD AGAIN' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ],
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'TikTok Download',
                        body: `By @${author.username}`,
                        mediaType: 2,
                        sourceUrl: tiktokUrl,
                        thumbnailUrl: thumbnail
                    }
                }
            });

            // Update loading message to success with buttons
            await socket.sendMessage(sender, {
                text: '✅ *Video downloaded successfully!*\n\nCheck above for your video! 🎬',
                buttons: [
                    {
                        buttonId: `${config.PREFIX}ig`,
                        buttonText: { displayText: '📸 INSTAGRAM DL' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX}menu`,
                        buttonText: { displayText: '📋 MAIN MENU' },
                        type: 1
                    }
                ],
                edit: loadingMsg.key
            });

            // Send success reaction
            await socket.sendMessage(sender, {
                react: {
                    text: "✅",
                    key: msg.key
                }
            });

        } catch (downloadError) {
            console.error('Video download failed:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download video.* The video might be too large or restricted.',
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

    } catch (err) {
        console.error("TikTok download error:", err);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '❌ *Failed to process TikTok video.*\nPlease check the URL and try again.',
            buttons: [
                {
                    buttonId: `${config.PREFIX}owner`,
                    buttonText: { displayText: '👑 GET HELP' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}menu`,
                    buttonText: { displayText: '📋 MAIN MENU' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}help`,
                    buttonText: { displayText: '❓ HOW TO USE' },
                    type: 1
                }
            ]
        }, { quoted: msg });
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
case 'fbdl':
case 'facebook':
case 'fbvideo':
case 'fb': {
    try {
        const axios = require('axios');
        
        // Extract query from message
        const q = msg.message?.conversation || 
                  msg.message?.extendedTextMessage?.text || 
                  msg.message?.imageMessage?.caption || 
                  msg.message?.videoMessage?.caption || '';
        
        const args = q.split(' ').slice(1);
        const fbUrl = args[0];

        if (!fbUrl || !fbUrl.includes("facebook.com")) {
            return await socket.sendMessage(sender, {
                text: '❌ *Please provide a valid Facebook video URL.*\nExample: .fbdl https://facebook.com/video/123'
            }, { quoted: msg });
        }

        // Send processing reaction
        await socket.sendMessage(sender, {
            react: {
                text: "⏳",
                key: msg.key
            }
        });

        // Prepare the primary API URL
        const primaryApiUrl = `https://apis.davidcyriltech.my.id/facebook2?url=${encodeURIComponent(fbUrl)}`;
        
        // Prepare fallback APIs
        const fallbackApis = [
            `https://kaiz-apis.gleeze.com/api/fbdl?url=${encodeURIComponent(fbUrl)}&apikey=cf2ca612-296f-45ba-abbc-473f18f991eb`,
            `https://api.giftedtech.web.id/api/download/facebook?apikey=gifted&url=${encodeURIComponent(fbUrl)}`
        ];

        let videoData = null;
        let apiIndex = 0;
        const apis = [primaryApiUrl, ...fallbackApis];

        // Try each API until we get a successful response
        while (apiIndex < apis.length && !videoData) {
            try {
                const response = await axios.get(apis[apiIndex], { timeout: 15000 });
                
                // Parse response based on which API responded
                if (apiIndex === 0) {
                    // Primary API response format
                    if (response.data && response.data.status && response.data.video) {
                        const { title, thumbnail, downloads } = response.data.video;
                        videoData = {
                            title: title || "Facebook Video",
                            thumbnail,
                            downloadUrl: downloads.find(d => d.quality === "HD")?.downloadUrl || downloads[0]?.downloadUrl,
                            quality: downloads.find(d => d.quality === "HD") ? "HD" : "SD"
                        };
                    }
                } else if (apiIndex === 1) {
                    // Kaiz API response format
                    if (response.data && response.data.videoUrl) {
                        videoData = {
                            title: response.data.title || "Facebook Video",
                            thumbnail: response.data.thumbnail,
                            downloadUrl: response.data.videoUrl,
                            quality: response.data.quality || "HD"
                        };
                    }
                } else if (apiIndex === 2) {
                    // GiftedTech API response format
                    if (response.data && response.data.success && response.data.result) {
                        const result = response.data.result;
                        videoData = {
                            title: result.title || "Facebook Video",
                            thumbnail: result.thumbnail,
                            downloadUrl: result.hd_video || result.sd_video,
                            quality: result.hd_video ? "HD" : "SD"
                        };
                    }
                }
            } catch (error) {
                console.error(`Error with API ${apiIndex}:`, error.message);
            }
            apiIndex++;
        }

        if (!videoData) {
            await socket.sendMessage(sender, {
                react: {
                    text: "❌",
                    key: msg.key
                }
            });
            return await socket.sendMessage(sender, {
                text: '❌ *All download services failed.*\nPlease try again later or use a different Facebook URL.'
            }, { quoted: msg });
        }

        // Send downloading message
        const loadingMsg = await socket.sendMessage(sender, {
            text: '⏳ *Downloading Facebook video... Please wait* 📥'
        }, { quoted: msg });

        try {
            // Download the video with timeout
            const videoResponse = await axios.get(videoData.downloadUrl, { 
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            if (!videoResponse.data) {
                throw new Error('Empty video response');
            }

            // Prepare the video buffer
            const videoBuffer = Buffer.from(videoResponse.data, 'binary');

            // Send the video with details
            await socket.sendMessage(sender, {
                video: videoBuffer,
                caption: `📥 *Facebook Video Download*\n\n` +
                    `🔖 *Title:* ${videoData.title}\n` +
                    `📏 *Quality:* ${videoData.quality}\n\n` +
                    `> ᴍᴀᴅᴇ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs xᴛᴇᴄʜ`,
                contextInfo: {
                    mentionedJid: [msg.key.participant || msg.key.remoteJid],
                    externalAdReply: {
                        title: 'Facebook Video Download',
                        body: `Quality: ${videoData.quality}`,
                        mediaType: 2,
                        sourceUrl: fbUrl,
                        thumbnailUrl: videoData.thumbnail
                    }
                }
            }, { quoted: msg });

            // Delete the loading message
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
            console.error('Video download failed:', downloadError);
            await socket.sendMessage(sender, {
                text: '❌ *Failed to download video.*\nThe video might be too large or restricted.'
            }, { quoted: msg });
        }

    } catch (error) {
        console.error('Facebook download error:', error);
        
        // Send error reaction
        await socket.sendMessage(sender, {
            react: {
                text: "❌",
                key: msg.key
            }
        });

        await socket.sendMessage(sender, {
            text: '❌ *Unable to process Facebook video.*\nPlease check the URL and try again later.'
        }, { quoted: msg });
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
case 'ginfo':
case 'gpinfo':
case 'groupinfo':
case 'gcinfo': {
    try {
        // React to the message
        await socket.sendMessage(sender, { react: { text: '🏷️', key: msg.key } });
        
        // Function to format creation date
        const formatCreationDate = (timestamp) => {
            if (!timestamp) return 'Unknown';
            const date = new Date(timestamp * 1000);
            return date.toLocaleString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZoneName: 'short'
            });
        };

        // Function to fetch and format group info
        const getGroupInfo = async (groupId) => {
            try {
                const groupMetadata = await socket.groupMetadata(groupId);
                const participants = groupMetadata.participants || [];
                
                // Get creator info
                const creator = groupMetadata.owner || groupMetadata.ownerJid || 'Unknown';
                
                // Get admins
                const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin).map(p => p.id);
                
                // Check if bot is admin
                const botParticipant = participants.find(p => p.id.includes(socket.user.id.split(':')[0]));
                const botIsAdmin = botParticipant?.admin || botParticipant?.isAdmin || false;
                
                // Prepare response
                let response = `*「 🏷️ ɢʀᴏᴜᴘ ɪɴғᴏʀᴍᴀᴛɪᴏɴ 」*\n`;
                response += `*╭──────────────────⊷*\n`;
                response += `*┃* *ɴᴀᴍᴇ* : ${groupMetadata.subject || 'Unknown'}\n`;
                response += `*┃* *ɪᴅ* : ${groupId.split('@')[0]}\n`;
                response += `*┃* *ᴄʀᴇᴀᴛᴏʀ* : @${creator.split('@')[0]}\n`;
                response += `*┃* *ᴍᴇᴍʙᴇʀs* : ${participants.length}\n`;
                response += `*┃* *ᴀᴅᴍɪɴs* : ${admins.length}\n`;
                response += `*┃* *ᴄʀᴇᴀᴛᴇᴅ* : ${formatCreationDate(groupMetadata.creation)}\n`;
                response += `*┃* *ʀᴇsᴛʀɪᴄᴛᴇᴅ* : ${groupMetadata.restrict ? '✅' : '❌'}\n`;
                response += `*┃* *ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛ* : ${groupMetadata.announce ? '✅' : '❌'}\n`;
                response += `*┃* *ᴇᴘʜᴇᴍᴇʀᴀʟ* : ${groupMetadata.ephemeralDuration ? `${groupMetadata.ephemeralDuration}s` : '❌'}\n`;
                response += `*┃* *ʙᴏᴛ sᴛᴀᴛᴜs* : ${botIsAdmin ? '✅ Admin' : '❌ Not Admin'}\n`;
                response += `*╰──────────────────⊷*\n\n`;
                response += `*📝 ᴅᴇsᴄʀɪᴘᴛɪᴏɴ:*\n${groupMetadata.desc || 'No description'}\n\n`;
                response += `*🎀 ʙᴏᴛ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs*`;
                
                // Try to get group picture
                try {
                    const ppUrl = await socket.profilePictureUrl(groupId);
                    return { response, ppUrl, groupMetadata, admins, creator, botIsAdmin };
                } catch (e) {
                    return { response, groupMetadata, admins, creator, botIsAdmin };
                }
            } catch (error) {
                throw error;
            }
        };

        // Check if there's a group link argument
        const groupLink = args?.join(' ') || '';
        
        if (isGroup) {
            // Fetch info for the current group
            const { response, ppUrl, groupMetadata, admins, creator, botIsAdmin } = await getGroupInfo(sender);
            
            // Create mentions array
            const mentions = [...admins];
            if (creator && !mentions.includes(creator)) {
                mentions.push(creator);
            }
            
            // Create interactive buttons
            const buttons = [
                {
                    buttonId: `${config.PREFIX || '!'}invite`,
                    buttonText: { displayText: '🔗 Invite Link' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX || '!'}admins`,
                    buttonText: { displayText: '⭐ Admins List' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX || '!'}members`,
                    buttonText: { displayText: '👥 Members' },
                    type: 1
                }
            ];
            
            // Add context info
            const contextInfo = {
                forwardingScore: 1,
                isForwarded: true,
                externalAdReply: {
                    title: `👥 ${groupMetadata.subject || 'Group Info'}`,
                    body: `${groupMetadata.size || '?'} members • ${admins.length} admins`,
                    thumbnail: ppUrl ? { url: ppUrl } : undefined,
                    mediaType: 1,
                    mediaUrl: '',
                    sourceUrl: '',
                    renderLargerThumbnail: false
                }
            };
            
            if (ppUrl) {
                // Send with image
                await socket.sendMessage(sender, {
                    image: { url: ppUrl },
                    caption: response,
                    mentions: mentions,
                    contextInfo: contextInfo,
                    buttons: buttons
                }, { quoted: fakevCard });
            } else {
                // Send without image
                await socket.sendMessage(sender, {
                    text: response,
                    mentions: mentions,
                    contextInfo: contextInfo,
                    buttons: buttons
                }, { quoted: fakevCard });
            }
            
        } else if (groupLink.includes('chat.whatsapp.com')) {
            // Handle group invite link
            // Extract group ID from link
            const groupId = groupLink.split('/').pop();
            
            try {
                // Verify the group exists
                const inviteInfo = await socket.groupGetInviteInfo(groupId);
                
                // Fetch group info
                const { response, ppUrl, groupMetadata } = await getGroupInfo(inviteInfo.id);
                
                // Create buttons for group link
                const buttons = [
                    {
                        buttonId: `${config.PREFIX || '!'}join ${groupId}`,
                        buttonText: { displayText: '🚪 Join Group' },
                        type: 1
                    },
                    {
                        buttonId: `${config.PREFIX || '!'}moreinfo ${groupId}`,
                        buttonText: { displayText: '📊 More Info' },
                        type: 1
                    }
                ];
                
                if (ppUrl) {
                    await socket.sendMessage(sender, { 
                        image: { url: ppUrl },
                        caption: response,
                        footer: `Group ID: ${inviteInfo.id.split('@')[0]}`,
                        buttons: buttons,
                        headerType: 4
                    }, { quoted: fakevCard });
                } else {
                    await socket.sendMessage(sender, {
                        text: response,
                        footer: `Group ID: ${inviteInfo.id.split('@')[0]}`,
                        buttons: buttons,
                        headerType: 1
                    }, { quoted: fakevCard });
                }
            } catch (error) {
                console.error("Error fetching group info from link:", error);
                await socket.sendMessage(sender, { 
                    text: '❌ Error fetching group info.\n\nMake sure:\n• The link is valid\n• You have permission to view this group\n• The group exists' 
                }, { quoted: fakevCard });
            }
            
        } else {
            // Command used in private chat without link
            await socket.sendMessage(sender, { 
                text: '🤔 Please use this command in a group or provide a WhatsApp group invite link.\n\n*Example:*\n' + (config.PREFIX || '!') + 'ginfo https://chat.whatsapp.com/XXXXXXXXXXXX' 
            }, { quoted: fakevCard });
        }
    } catch (error) {
        console.error("Error in ginfo command:", error);
        
        let errorMsg = "❌ Failed to fetch group information.\n\n";
        
        if (error.message.includes("not in group")) {
            errorMsg += "I'm not a member of this group.";
        } else if (error.message.includes("401") || error.message.includes("Not Authorized")) {
            errorMsg += "I don't have permission to access this group.";
        } else if (error.message.includes("invite")) {
            errorMsg += "Invalid group invite link.";
        } else {
            errorMsg += `Error: ${error.message}`;
        }
        
        await socket.sendMessage(sender, { 
            text: errorMsg 
        }, { quoted: fakevCard });
    }
    break;
}

// Helper case for admin list
case 'admins': {
    try {
        await socket.sendMessage(sender, { react: { text: '⭐', key: msg.key } });
        
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ This command only works in group chats.'
            }, { quoted: fakevCard });
        }
        
        const groupMetadata = await socket.groupMetadata(sender);
        const participants = groupMetadata.participants || [];
        const admins = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin);
        
        let adminList = `*⭐ ɢʀᴏᴜᴘ ᴀᴅᴍɪɴɪsᴛʀᴀᴛᴏʀs (${admins.length})*\n\n`;
        adminList += admins.map((admin, index) => {
            const number = admin.id.split('@')[0];
            const name = admin.name || admin.notify || `User ${number}`;
            return `${index + 1}. @${number} - ${name}`;
        }).join('\n');
        
        await socket.sendMessage(sender, {
            text: adminList,
            mentions: admins.map(a => a.id)
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error("Error in admins command:", error);
    }
    break;
}
// Helper case for members list
case 'members': {
    try {
        await socket.sendMessage(sender, { react: { text: '👥', key: msg.key } });
        
        if (!isGroup) {
            return await socket.sendMessage(sender, {
                text: '❌ This command only works in group chats.'
            }, { quoted: fakevCard });
        }
        
        const groupMetadata = await socket.groupMetadata(sender);
        const participants = groupMetadata.participants || [];
        
        let memberList = `*👥 ɢʀᴏᴜᴘ ᴍᴇᴍʙᴇʀs (${participants.length})*\n\n`;
        memberList += participants.map((member, index) => {
            const number = member.id.split('@')[0];
            const name = member.name || member.notify || `User ${number}`;
            const role = member.admin ? ' (Admin)' : '';
            return `${index + 1}. @${number} - ${name}${role}`;
        }).join('\n');
        
        await socket.sendMessage(sender, {
            text: memberList,
            mentions: participants.map(p => p.id)
        }, { quoted: fakevCard });
        
    } catch (error) {
        console.error("Error in members command:", error);
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
case 'repo':
case 'sc':
case 'script': {
    try {
        await socket.sendMessage(sender, { react: { text: '🪄', key: msg.key } });
        
        // Get repo info from GitHub API
        const response = await fetch(`https://api.github.com/repos/caseyweb/CASEYRHODES-XMD`);
        
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        
        const repoData = await response.json();

        const formattedInfo = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 🎀*
*╭──────────────⊷*
*┃* *ɴᴀᴍᴇ*        : ${repoData.name}
*┃* *sᴛᴀʀs*       : ${repoData.stargazers_count}
*┃* *ғᴏʀᴋs*       : ${repoData.forks_count}
*┃* *ᴏᴡɴᴇʀ*       : ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃* *ᴅᴇsᴄ*        : ${repoData.description || 'ɴ/ᴀ'}
*╰──────────────⊷*

📁 *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ*
`;

        const repoMessage = {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: formattedInfo,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            },
            buttons: [
                {
                    buttonId: `${config.PREFIX}repo-visit`,
                    buttonText: { displayText: '🌐 Visit Repo' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-owner`,
                    buttonText: { displayText: '👑 Owner Profile' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-audio`,
                    buttonText: { displayText: '🎵 Play Intro' },
                    type: 1
                }
            ]
        };

        await socket.sendMessage(from, repoMessage, { quoted: fakevCard });

    } catch (error) {
        console.error("❌ Error in repo command:", error);
        // Fallback if API fails
        const fallbackInfo = `
*🎀 𝐂𝐀𝐒𝐄𝐘𝐑𝐇𝐎𝐃𝐄𝐒 𝐌𝐈𝐍𝐈 🎀*
*╭──────────────⊷*
*┃* *ɴᴀᴍᴇ*        : CASEYRHODES-XMD
*┃* *sᴛᴀʀs*       : Loading...
*┃* *ғᴏʀᴋs*       : Loading...
*┃* *ᴏᴡɴᴇʀ*       : ᴄᴀsᴇʏʀʜᴏᴅᴇs
*┃* *ᴅᴇsᴄ*        : WhatsApp Multi-Device Bot
*╰──────────────⊷*

📁 *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs ᴛᴇᴄʜ*
`;
        
        const fallbackMessage = {
            image: { url: 'https://i.ibb.co/fGSVG8vJ/caseyweb.jpg' },
            caption: fallbackInfo,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363420261263259@newsletter',
                    newsletterName: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴄᴀsᴇʏʀʜᴏᴅᴇs 🎀',
                    serverMessageId: -1
                }
            },
            buttons: [
                {
                    buttonId: `${config.PREFIX}repo-visit`,
                    buttonText: { displayText: '🌐 Visit Repo' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-owner`,
                    buttonText: { displayText: '👑 Owner Profile' },
                    type: 1
                },
                {
                    buttonId: `${config.PREFIX}repo-audio`,
                    buttonText: { displayText: '🎵 Play Intro' },
                    type: 1
                }
            ]
        };
        
        await socket.sendMessage(from, fallbackMessage, { quoted: fakevCard });
    }
    break;
}

// Button handlers for repo
case 'repo-visit': {
    try {
        await socket.sendMessage(sender, { react: { text: '🌐', key: msg.key } });
        
        // Create button message with link
        const visitMessage = {
            text: `🌐 *Click the button below to visit the repository:*`,
            buttons: [
                {
                    urlButton: {
                        displayText: '🌟 Visit GitHub Repo',
                        url: 'https://github.com/caseyweb/CASEYRHODES-XMD'
                    }
                },
                {
                    quickReplyButton: {
                        displayText: '📋 Back to Menu',
                        id: `${config.PREFIX}menu`
                    }
                }
            ]
        };
        
        await socket.sendMessage(from, visitMessage, { quoted: fakevCard });
    } catch (error) {
        console.error("Error in repo-visit:", error);
        await socket.sendMessage(from, {
            text: `🌐 *Repository Link:*\nhttps://github.com/caseyweb/CASEYRHODES-XMD`
        }, { quoted: fakevCard });
    }
    break;
}

case 'repo-owner': {
    try {
        await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
        
        // Create button message with link
        const ownerMessage = {
            text: `👑 *Click the button below to visit the owner's profile:*`,
            buttons: [
                {
                    urlButton: {
                        displayText: '👤 Visit Owner Profile',
                        url: 'https://github.com/caseyweb'
                    }
                },
                {
                    quickReplyButton: {
                        displayText: '📋 Back to Menu',
                        id: `${config.PREFIX}menu`
                    }
                }
            ]
        };
        
        await socket.sendMessage(from, ownerMessage, { quoted: fakevCard });
    } catch (error) {
        console.error("Error in repo-owner:", error);
        await socket.sendMessage(from, {
            text: `👑 *Owner Profile:*\nhttps://github.com/caseyweb`
        }, { quoted: fakevCard });
    }
    break;
}

case 'repo-audio': {
    try {
        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        
        // First send a loading message
        await socket.sendMessage(from, {
            text: '🎵 *Preparing audio introduction...*'
        }, { quoted: fakevCard });
        
        // Send audio file
        await socket.sendMessage(from, {
            audio: { url: 'https://files.catbox.moe/z47dgd.mp3' },
            mimetype: 'audio/mp4',
            ptt: true,
            caption: '🎵 *CaseyRhodes Tech Audio Introduction*'
        }, { quoted: fakevCard });
        
        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
        
    } catch (audioError) {
        console.error("Audio error:", audioError);
        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
        
        // Fallback to text if audio fails
        await socket.sendMessage(from, {
            text: "🎵 *Audio Introduction*\n\nSorry, the audio is currently unavailable. Please try again later."
        }, { quoted: fakevCard });
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
