// Set this for environments with corporate proxy SSL interception (e.g., Netskope)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

const CONFIG = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    recipient: process.env.RECIPIENT_EMAIL || 'nikkamalf@gmail.com',
    ticker: process.env.TICKER || 'GLD',
    historyPath: path.resolve(__dirname, 'alert-history.json'),
    websiteDataPath: path.resolve(__dirname, '../website/public/data.json'),
};

/**
 * Fetches historical data from Stooq CSV API.
 */
async function fetchHistoricalData(ticker) {
    const symbol = ticker.toLowerCase() === 'gld' ? 'gld.us' : ticker.toLowerCase();
    const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`;

    console.log(`Fetching data from Stooq for ${symbol}...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Stooq fetch failed: ${response.statusText}`);

    const csv = await response.text();
    const lines = csv.trim().split('\n');

    return lines.slice(1).map(line => {
        const [date, open, high, low, close, volume] = line.split(',');
        return {
            date: new Date(date),
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close)
        };
    }).filter(d => !isNaN(d.open) && !isNaN(d.high) && !isNaN(d.low) && !isNaN(d.close));
}

/**
 * Calculates Ichimoku Cloud components for a specific index in the data array.
 */
function getIchimokuAt(data, index) {
    if (index < 52 + 25) return null; // Not enough lead-up data

    const getHL = (slice) => {
        let h = -Infinity, l = Infinity;
        for (const d of slice) {
            if (d.high > h) h = d.high;
            if (d.low < l) l = d.low;
        }
        return { h, l };
    };

    // Current point
    const tenkanHL = getHL(data.slice(index - 8, index + 1));
    const tenkan = (tenkanHL.h + tenkanHL.l) / 2;

    const kijunHL = getHL(data.slice(index - 25, index + 1));
    const kijun = (kijunHL.h + kijunHL.l) / 2;

    // Senkou Spans (offset by 26)
    const t26 = getHL(data.slice(index - 25 - 9, index - 25 + 1));
    const k26 = getHL(data.slice(index - 25 - 26, index - 25 + 1));
    const spanA = (((t26.h + t26.l) / 2) + ((k26.h + k26.l) / 2)) / 2;

    const b52 = getHL(data.slice(index - 25 - 52, index - 25 + 1));
    const spanB = (b52.h + b52.l) / 2;

    return { tenkan, kijun, spanA, spanB };
}

/**
 * Sends email alert via SMTP.
 */
async function sendEmail(subject, body) {
    if (!CONFIG.user || !CONFIG.pass) {
        console.warn('SMTP credentials missing. Skipping email.');
        return;
    }

    const transporter = nodemailer.createTransport({
        host: CONFIG.host,
        port: CONFIG.port,
        secure: false,
        auth: { user: CONFIG.user, pass: CONFIG.pass },
    });

    // Send to each recipient individually for privacy
    const recipients = CONFIG.recipient.split(',').map(email => email.trim());

    for (const recipient of recipients) {
        if (!recipient) continue;
        try {
            const info = await transporter.sendMail({
                from: `"Gold Tracker" <${CONFIG.user}>`,
                to: recipient,
                subject: subject,
                text: body,
                html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
            });
            console.log(`Message sent to ${recipient}: %s`, info.messageId);
        } catch (err) {
            console.error(`Email failed for ${recipient}:`, err.message);
        }
    }
}

/**
 * Prevents duplicate alerts.
 */
function checkAlertHistory(signal, date) {
    if (!fs.existsSync(CONFIG.historyPath)) {
        fs.writeFileSync(CONFIG.historyPath, JSON.stringify({}));
    }
    const history = JSON.parse(fs.readFileSync(CONFIG.historyPath, 'utf8'));
    const key = `${signal}-${date.split('T')[0]}`;
    if (history[key]) return true;
    history[key] = true;
    fs.writeFileSync(CONFIG.historyPath, JSON.stringify(history));
    return false;
}

/**
 * Main execution loop.
 */
async function run() {
    try {
        console.log(`Checking ${CONFIG.ticker} for Ichimoku signals...`);
        const data = await fetchHistoricalData(CONFIG.ticker);

        if (data.length < 80) {
            console.log(`Not enough data (${data.length}/80 days).`);
            return;
        }

        // Calculate latest
        const latestIdx = data.length - 1;
        const latestIchimoku = getIchimokuAt(data, latestIdx);
        const price = data[latestIdx].close;
        const date = data[latestIdx].date.toISOString();

        if (!latestIchimoku) throw new Error('Failed to calculate indicators');

        console.log(`Latest date: ${date.split('T')[0]}`);
        console.log(`Price: $${price.toFixed(2)} | Tenkan: ${latestIchimoku.tenkan.toFixed(2)} | Kijun: ${latestIchimoku.kijun.toFixed(2)}`);

        let signal = '';
        if (latestIchimoku.tenkan > latestIchimoku.kijun && price > Math.max(latestIchimoku.spanA, latestIchimoku.spanB)) {
            signal = 'BUY';
        } else if (latestIchimoku.tenkan < latestIchimoku.kijun && price < Math.min(latestIchimoku.spanA, latestIchimoku.spanB)) {
            signal = 'SELL';
        }

        if (signal) {
            if (!checkAlertHistory(signal, date)) {
                console.log(`Generating a new ${signal} signal!`);
                await sendEmail(
                    `${signal} Signal Alert: ${CONFIG.ticker}`,
                    `Ichimoku ${signal} signal detected for ${CONFIG.ticker}.\n\nPrice: $${price.toFixed(2)}`
                );
            }
        }

        // --- Persistent Signal History ---
        const historyData = JSON.parse(fs.existsSync(CONFIG.historyPath) ? fs.readFileSync(CONFIG.historyPath, 'utf8') : '{}');
        const signalsArray = Object.keys(historyData).map(key => {
            const parts = key.split('-');
            const type = parts[0];
            const dStr = parts.slice(1).join('-');
            return { type, date: dStr };
        });

        // Prepare chart range (last 40 points)
        const displayHistory = data.slice(-40).map((d, i) => {
            const absIdx = data.length - 40 + i;
            const indicators = getIchimokuAt(data, absIdx);
            return {
                date: d.date.toISOString().split('T')[0],
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                price: d.close,
                tenkan: indicators?.tenkan || null,
                kijun: indicators?.kijun || null,
                spanA: indicators?.spanA || null,
                spanB: indicators?.spanB || null
            };
        });

        const websiteData = {
            ticker: CONFIG.ticker,
            price: price,
            date: date,
            signal: signal || 'NEUTRAL',
            signalHistory: signalsArray,
            ichimoku: {
                tenkan: latestIchimoku.tenkan,
                kijun: latestIchimoku.kijun,
                senkouA: latestIchimoku.spanA,
                senkouB: latestIchimoku.spanB
            },
            history: displayHistory
        };

        const dir = path.dirname(CONFIG.websiteDataPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(CONFIG.websiteDataPath, JSON.stringify(websiteData, null, 2));
        console.log(`Updated website data with full indicator history.`);

    } catch (error) {
        console.error('Error in Gold Tracker execution:', error.message);
        process.exit(1);
    }
}

run();
