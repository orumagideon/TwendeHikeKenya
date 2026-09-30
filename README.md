# TwendeHike Kenya

TwendeHike Kenya is a Kenyan hiking and outdoor marketplace application that allows hikers to discover trails, book hikes, pay through M-PESA, download digital passes, and access a personal profile page. The platform also includes organizer approval workflows, a superadmin dashboard, and a trail-host studio for checking in hikers.

## What the system does

- Browse outdoor trail listings by difficulty, county, and price
- Search and filter trails across Kenya
- Book hikes through an M-PESA checkout flow
- Generate per-user passes with ticket references and QR-style ticket views
- Save a private hiker profile with name and phone details
- Allow organizers to submit hikes for approval
- Give the superadmin control over approvals, removals, completion, and password reset
- Support organizer login and event check-in tracking
- Display removed and completed hikes in lifecycle lists

## How the system works

The platform is split into a frontend app and a backend API.

### Frontend
The client app is built with React and Vite. It presents the user-facing marketplace UI, booking flow, admin dashboard, organizer studio, and ticket modal views.

### Backend
The server is built with Node.js and Express. It handles:
- JWT-based authentication
- password hashing with bcrypt
- public event and county APIs
- M-PESA STK push initiation and callback handling
- PDF ticket generation logic
- admin and organizer role checks

### Database
The project includes PostgreSQL schema files under the backend SQL directory for a production-ready marketplace structure, including tables for users, trails/events, bookings, organizers, payments, and ticket records.

## Tech stack

### Frontend
- React
- Vite
- JavaScript / JSX
- CSS for responsive UI and dark mode

### Backend
- Node.js
- Express.js
- PostgreSQL
- JWT
- bcryptjs
- PDFKit
- UUID

### Payment and ticketing
- Safaricom M-PESA integration flow
- digital pass generation
- PDF ticket download support

## Project structure

- src/ — frontend React application
- public/ — static public assets
- backend/ — Express API, middleware, services, and SQL schema
- backend/sql/ — PostgreSQL setup scripts

## Local setup

1. Install frontend dependencies:
   npm install

2. Install backend dependencies:
   cd backend && npm install

3. Start the frontend:
   npm run dev

4. Start the backend:
   cd backend && npm start

5. Open the app in the browser at the Vite local URL (typically http://localhost:5173)

## Default admin login

- Email: admin@twendehike.co.ke
- Password: @oruma

## Notes

This project is a full-stack prototype for a hiking marketplace and booking platform in Kenya. It combines a strong UI flow with backend-ready architecture for authentication, payments, and ticketing.

## Repository status

The project is set up as a Git repository and is intended to be pushed to GitHub for version control and deployment workflows.
