const axios = require('axios');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// ฟังก์ชันกลางสำหรับส่ง Discord Webhook
async function sendDiscordEmbed(embedData) {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('DISCORD_WEBHOOK_URL is not defined in environment variables.');
    return;
  }

  try {
    await axios.post(DISCORD_WEBHOOK_URL, {
      embeds: [
        {
          ...embedData,
          timestamp: new Date().toISOString(),
          footer: {
            text: 'BALL-RB System Notification'
          }
        }
      ]
    });
  } catch (error) {
    console.error('Failed to send Discord notification:', error.response?.data || error.message);
  }
}

// 1. แจ้งเตือนสมาชิกใหม่สมัคร
async function notifyNewUser(username, email) {
  await sendDiscordEmbed({
    title: '👤 สมาชิกใหม่สมัครใช้งาน!',
    color: 0x3498db, // สีฟ้า
    fields: [
      { name: 'Username', value: username, inline: true },
      { name: 'Email', value: email, inline: true }
    ]
  });
}

// 2. แจ้งเตือนรายการฝากเงิน
async function notifyDeposit(username, amount, bankName, transactionId) {
  await sendDiscordEmbed({
    title: '💰 มีรายการฝากเงินเข้ามา!',
    color: 0x2ecc71, // สีเขียว
    fields: [
      { name: 'ผู้ใช้งาน', value: username, inline: true },
      { name: 'จำนวนเงิน', value: `**${Number(amount).toLocaleString()} บาท**`, inline: true },
      { name: 'ช่องทาง/ธนาคาร', value: bankName || '-', inline: false },
      { name: 'รหัสรายการ', value: transactionId || '-', inline: false }
    ]
  });
}

// 3. แจ้งเตือนรายการถอนเงิน
async function notifyWithdrawal(username, amount, bankAccount, transactionId) {
  await sendDiscordEmbed({
    title: '💸 มีรายการแจ้งถอนเงิน!',
    color: 0xe74c3c, // สีแดง
    fields: [
      { name: 'ผู้ใช้งาน', value: username, inline: true },
      { name: 'จำนวนเงินที่ถอน', value: `**${Number(amount).toLocaleString()} บาท**`, inline: true },
      { name: 'บัญชีรับเงิน', value: bankAccount || '-', inline: false },
      { name: 'รหัสรายการ', value: transactionId || '-', inline: false }
    ]
  });
}

module.exports = {
  notifyNewUser,
  notifyDeposit,
  notifyWithdrawal
};
