Eksi Sozluk Debe Reader
A web application that scrapes the daily most popular entries ("debe") from Ekşi Sözlük, archives them, and presents them in a clean, responsive, and fun "Visual Studio" themed interface.

✨ Live Demo ✨
https://www.halilurkmez.com/debe

📖 About The Project
This project offers a streamlined interface for Ekşi Sözlük's daily popular entries ("debe"). To ensure high performance and prevent unnecessary traffic to the source website, it automatically scrapes and caches the entries in a database once a day. The frontend features a unique Visual Studio IDE theme, providing a familiar and engaging experience for developers.

🚀 Features
Daily Scraping: A background job automatically scrapes the latest popular entries every day.

Database Caching: All scraped data is stored in a PostgreSQL database to ensure fast load times and prevent re-scraping.

Date Archive: Users can browse and read the popular entries from previous days.

Responsive Design: A clean and functional UI that works on both desktop and mobile devices.

Unique VS Code Theme: A developer-centric, interactive theme that mimics the Visual Studio IDE.

Decoupled Architecture: A modern architecture with a separate frontend and a backend API.

🛠️ Tech Stack
This project is built with a modern, decoupled architecture.

Backend
Runtime: Node.js

Framework: Express.js

Web Scraping: Puppeteer

Database: PostgreSQL

Frontend
Markup/Styling: HTML5, CSS3

Framework: Bootstrap 5

JavaScript: Vanilla JS (ES6+)

Deployment
Backend API: Hosted on Render.com as a Web Service.

Database: Hosted on Render.com as a PostgreSQL instance.

Scraping Trigger: A free external Cron Job service (cron-job.org) triggers the scraping process daily.

Frontend UI: Hosted on Netlify (or any static host).

⚙️ Getting Started (Local Setup)
To get a local copy up and running, follow these simple steps.

Prerequisites
Node.js (v18 or later)

A local PostgreSQL server running.

Installation
Clone the repo:

git clone https://github.com/halil385/DebeReader.git


Navigate to the project directory:

cd DebeReader


Install NPM packages:

npm install


Set up your local database connection:

Create a new PostgreSQL database.

Update the connection details in index.js to match your local setup.

Run the application:

node index.js


The API will be available at http://localhost:3000.

📄 License
Distributed under the MIT License. See LICENSE for more information.

👤 Contact
Halil Ürkmez - @halil385

Project Link: https://github.com/halil385/DebeReader
