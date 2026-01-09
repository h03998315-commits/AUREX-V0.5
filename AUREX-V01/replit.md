# AUREX Genesis Core

## Overview
AUREX is a Telegram bot for managing a rewards/points system with:
- Daily rewards and streak tracking
- Referral system
- UPI-based fund additions
- Coupon shop with admin management
- Withdrawal requests with admin approval

## Tech Stack
- **Runtime**: Node.js (ES Modules)
- **Framework**: Telegraf (Telegram Bot Framework)
- **Database**: SQLite (better-sqlite3)
- **Web Server**: Express (health check endpoint)

## Project Structure
```
├── index.js          # Main bot application
├── aurex.db          # SQLite database
├── coupons.json      # Coupon data (if any)
├── package.json      # Dependencies
└── replit.md         # This file
```

## Environment Variables
- `BOT_TOKEN` (required): Telegram Bot API token from @BotFather

## Running the Project
```bash
npm start
```

The bot runs on port 5000 with a simple health check endpoint.

## Database Tables
- `users`: User accounts with balance, streak, referrals
- `coupons`: Shop items with codes
- `withdrawals`: Withdrawal requests
- `payments`: UPI payment records

## Recent Changes
- 2026-01-06: Added missing `payments` table to database schema
