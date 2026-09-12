const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

let whatsappClient;
let isClientReady = false;

// Initialize WhatsApp Client
const client = new Client({
  authStrategy: new LocalAuth(),
  headless: true,
  args: ['--no-sandbox']
});

// QR Code Event
client.on('qr', (qr) => {
  console.log('\n📱 Scan this QR code with WhatsApp to authenticate:');
  qrcode.generate(qr, { small: true });
});

// Ready Event
client.on('ready', () => {
  console.log('✅ WhatsApp bot is ready!');
  isClientReady = true;
  whatsappClient = client;
});

// Authenticated Event
client.on('authenticated', () => {
  console.log('✨ WhatsApp authenticated successfully!');
});

// Disconnected Event
client.on('disconnected', (reason) => {
  console.log('❌ WhatsApp disconnected:', reason);
  isClientReady = false;
});

// Error Handler
client.on('error', error => {
  console.error('WhatsApp Error:', error);
});

// Initialize Client
client.initialize();

// ===== GITHUB WEBHOOK HANDLER =====

// Verify GitHub webhook signature
const verifyGitHubSignature = (req, secret) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  
  const payload = JSON.stringify(req.body);
  const hash = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(hash, signature);
};

// Format GitHub event message
const formatGitHubMessage = (event, payload) => {
  let message = '';

  switch (event) {
    case 'push':
      message = `🔔 *GitHub Push Event*\n`;
      message += `Repository: ${payload.repository.name}\n`;
      message += `Branch: ${payload.ref.split('/').pop()}\n`;
      message += `Commits: ${payload.commits.length}\n`;
      if (payload.commits.length > 0) {
        message += `Latest: ${payload.commits[0].message}\n`;
        message += `Author: ${payload.commits[0].author.name}\n`;
      }
      break;

    case 'pull_request':
      const action = payload.action.toUpperCase();
      message = `🔔 *GitHub Pull Request ${action}*\n`;
      message += `Title: ${payload.pull_request.title}\n`;
      message += `Author: ${payload.pull_request.user.login}\n`;
      message += `Link: ${payload.pull_request.html_url}\n`;
      break;

    case 'issues':
      message = `🔔 *GitHub Issue ${payload.action.toUpperCase()}*\n`;
      message += `Title: ${payload.issue.title}\n`;
      message += `Author: ${payload.issue.user.login}\n`;
      message += `Link: ${payload.issue.html_url}\n`;
      break;

    case 'release':
      message = `🔔 *GitHub Release ${payload.action.toUpperCase()}*\n`;
      message += `Release: ${payload.release.tag_name}\n`;
      message += `Author: ${payload.release.author.login}\n`;
      message += `Link: ${payload.release.html_url}\n`;
      break;

    case 'star':
      message = `⭐ *Repository Starred*\n`;
      message += `Repository: ${payload.repository.name}\n`;
      message += `Total Stars: ${payload.repository.stargazers_count}\n`;
      break;

    default:
      message = `🔔 *GitHub Event: ${event}*\n`;
      message += `Repository: ${payload.repository.name}\n`;
  }

  return message;
};

// GitHub Webhook Endpoint
app.post('/webhook/github', async (req, res) => {
  try {
    // Verify webhook signature
    if (!verifyGitHubSignature(req, process.env.GITHUB_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    if (!isClientReady) {
      return res.status(503).json({ error: 'WhatsApp client not ready' });
    }

    const event = req.headers['x-github-event'];
    const payload = req.body;

    // Get WhatsApp group ID
    const groupId = process.env.WHATSAPP_GROUP_ID;
    
    // Format message
    const message = formatGitHubMessage(event, payload);

    // Send message to WhatsApp group
    await whatsappClient.sendMessage(groupId, message);

    console.log(`✅ Message sent for ${event} event`);
    res.json({ success: true, event });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== HEALTH CHECK =====

app.get('/health', (req, res) => {
  res.json({
    status: isClientReady ? 'ready' : 'initializing',
    whatsapp: isClientReady ? 'connected' : 'disconnected'
  });
});

// ===== START SERVER =====

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Webhook URL: http://localhost:${PORT}/webhook/github`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  client.destroy();
  process.exit(0);
});
