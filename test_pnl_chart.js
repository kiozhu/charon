// Test script to simulate /pnl flow
import { spawn } from 'child_process';
import fs from 'fs';
import { db } from './src/db/connection.js';
import { bot } from './src/telegram/bot.js';
import { TELEGRAM_CHAT_ID, TELEGRAM_TOPIC_ID } from './src/config.js';

const chartPath = '/home/ubuntu/charon2/scripts/pnl_chart.png';
const chatId = TELEGRAM_CHAT_ID;

console.log('=== Testing /pnl flow ===');

// Step 1: Generate chart
console.log('Step 1: Generating chart...');
await new Promise((resolve, reject) => {
  const child = spawn('/home/ubuntu/.hermes/venv/bin/python3', ['/home/ubuntu/charon2/scripts/pnl_chart.py'], { timeout: 30000 });
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`exit ${code}`)));
  child.on('error', reject);
});
console.log('Chart generated, size:', fs.statSync(chartPath).size);

// Step 2: Send chart via bot.sendPhoto
console.log('Step 2: Sending photo via bot.sendPhoto...');
const stream = fs.createReadStream(chartPath);
const sent = await bot.sendPhoto(chatId, stream, {
  ...(TELEGRAM_TOPIC_ID ? { message_thread_id: Number(TELEGRAM_TOPIC_ID) } : {}),
});
console.log('Photo sent! message_id:', sent.message_id);

process.exit(0);