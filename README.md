# Barber Pro

Монголын барбершопуудад зориулсан QR дараалал, онлайн захиалгын систем.

## Project Structure

```
├── server.js                  # Backend server (Node.js)
├── public/                    # Live web app
│   ├── admin.html             # Admin dashboard
│   ├── admin.js               # Admin dashboard logic
│   ├── booking3.html          # Customer booking flow
│   ├── signup.html            # Shop signup page
│   ├── landing.html           # Live landing page (dark theme)
│   └── poster-noshow.html     # No-show marketing poster
├── prototype-premium.html     # Landing page prototype (white theme, mobile-responsive)
├── landing-pages/             # Experimental landing pages
│   ├── old-v2.html            # Previous prototype version
│   └── dark-experiment.html   # Dark theme hybrid experiment
└── README.md
```

## Features

- QR queue system for barbershops
- Online appointment booking
- QPay deposit payments
- Commission calculation
- Real-time analytics and charts
- SMS notifications
- Multi-barber support

## Setup

```bash
# Install dependencies
npm install

# For development
node server.js
# Server runs on http://localhost:3000

# For production
# Use PM2 or systemd to keep the server running
```

## Landing Page Prototype

`prototype-premium.html` is a clean, mobile-first landing page with:

- White/light marketing theme
- Dark product showcase section (matching the app's actual UI)
- Phone booking mockup
- iPad admin dashboard mockup
- Floating animations on device mockups
- Responsive design from iPhone to 4K
- 48px minimum touch targets on mobile
- Pure CSS — no frameworks, no dependencies

Open it directly in any browser or deploy to any static host.

## Tech Stack

- **Backend**: Node.js, Express, SQLite
- **Frontend**: Vanilla HTML/CSS/JS
- **Payments**: QPay API
- **Fonts**: Inter (Google Fonts)
