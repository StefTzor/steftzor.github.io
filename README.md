# Stefanos Tzortzoglou | Personal Portfolio

> **Live Site:** [steftzor.github.io](https://steftzor.github.io)

This repository contains the source code for my personal portfolio. It serves as a technical bridge between my commercial experience as a **Technical Customer Success Manager** and my foundational engineering skills.

The architecture reflects my approach to problem-solving: highly logical, lightweight, secure, and easily maintainable. 

## 🛠️ Tech Stack

* **Static Site Generator:** [11ty (Eleventy)](https://11ty.dev/) utilizing Nunjucks templating for modular component rendering.
* **Styling:** [Tailwind CSS](https://tailwindcss.com/) for a fully responsive, utility-first design system with native Light/Dark mode support.
* **Authentication:** [Firebase](https://firebase.google.com/) handles secure user registration and login to gate exclusive content, architected to prevent API key exposure.
* **Live Integrations:** GitHub API integration for dynamic contribution calendars and live language statistics.
* **Deployment:** CI/CD via **GitHub Actions**, deployed to **GitHub Pages**.

## 🚀 Key Features

* **Gated Content Engine:** A custom-built Firebase authentication flow that restricts specific case studies to registered users.
* **Dynamic Theme Toggling:** Light/Dark mode switching built directly into the Tailwind configuration.
* **Live GitHub Telemetry:** Real-time fetching of GitHub contribution graphs and language statistics.
* **Responsive Interactive Canvas:** A lightweight, interactive geometry mesh in the hero section that responds to user mouse events.

## 💻 Local Development

If you want to clone and run this project locally, follow these steps:

### 1. Clone the repository:

```bash
git clone https://github.com/StefTzor/steftzor.github.io.git
cd steftzor.github.io
```

### 2. Install dependencies:

```bash
npm install
```

### 3. Configure Environment Variables:

Create a `.env` file in the root directory and add your Firebase configuration variables to ensure the authentication flows work locally.

### 4. Run the development server:

```bash
npm run start
```

*This will concurrently compile the Tailwind CSS and serve the 11ty static files on `localhost:8080`.*

### 5. Build for production:

```bash
npm run build
```

## 🏗️ Architecture Philosophy

As an Implementation Lead and Technical CSM, I advocate for pragmatism and Open Source tools. This repository reflects that philosophy:

* **No unnecessary frameworks:** A personal portfolio does not require complex client-side state management (like React or Next.js). 11ty provides the exact speed and simplicity required.
* **Security-conscious:** Firebase rules and environment variables are strictly configured to ensure user data remains secure and private.
* **Built to scale:** Structured so that adding new case studies or adjusting the Tailwind theme takes minutes, not hours.

---
*Designed and engineered by [Stefanos Tzortzoglou](https://www.linkedin.com/in/stzortzoglou/).*