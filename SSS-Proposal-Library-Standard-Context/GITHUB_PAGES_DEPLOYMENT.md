# GitHub Pages Deployment Guide

## Prerequisites
- GitHub account
- Git installed on your machine
- This project folder

## Step 1: Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name the repository (e.g., `sss-proposal-library`)
3. Choose **Public** (required for GitHub Pages free tier)
4. **Do NOT** initialize with README, .gitignore, or license (we have our own)
5. Click **Create repository**

## Step 2: Initialize and Push to GitHub

From the project folder, run these commands in order:

```bash
git init
git add .
git commit -m "Initial commit: SSS Proposal Library static site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sss-proposal-library.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username and repository name.

## Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top navigation)
3. In the left sidebar, click **Pages**
4. Under "Build and deployment":
   - **Source**: Select `Deploy from a branch`
   - **Branch**: Select `main` and `/root` folder
   - Click **Save**

## Step 4: Wait for Deployment

GitHub will deploy within 1–2 minutes. Once complete, you'll see:

> Your site is live at `https://YOUR_USERNAME.github.io/sss-proposal-library/`

Access the site using that URL. All relative links (search, tabs, document reader, PDF links, Ask Cory) will work correctly.

## Testing the Deployment

After your site is live, test these features:

- **Tabs**: Click "Past Performance", "Team", and "Pricing"—each section should filter correctly
- **Search**: Type keywords like "price", "team", "accessibility"
- **Document Reader**: Click any card to open the document viewer
- **PDF Links**: Click the "Open PDF ↗" button in the reader to verify PDF downloads work
- **Ask Cory**: Click the "✨ Ask Cory" button and type questions like "What is the total price?" or "Who is the lead developer?"
- **Mobile**: Test on phone/tablet to verify responsive layout

## Updating the Site

To make changes and redeploy:

```bash
# Make your edits to index.html or other files
git add .
git commit -m "Update: describe your changes"
git push origin main
```

GitHub Pages will automatically redeploy. Changes typically appear within 1–2 minutes.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Site shows 404 | Verify Settings > Pages shows "Your site is live at..." |
| PDFs don't download | Ensure `pdfs/` folder is in the repo and contains all 5 PDF files |
| Styles look broken | Check browser console (F12) for CSS/JS errors; clear cache |
| Search doesn't work | Verify index.html loads fully; check that data-text attributes are populated |
| Mobile layout broken | Test in incognito/private mode to rule out cache issues |

## File Structure for Deployment

Your GitHub repository should have this structure:

```
sss-proposal-library/
├── index.html                           (main page)
├── pdfs/
│   ├── PPQ-Example-1-Public-Sector.pdf
│   ├── PPQ-Example-2-Higher-Ed.pdf
│   ├── PPQ-Example-3-Commercial.pdf
│   ├── Key-Personnel-Roster.pdf
│   └── Cost-Price-Volume.pdf
├── .gitignore
├── README.md
└── GITHUB_PAGES_DEPLOYMENT.md
```

## DNS & Custom Domain (Optional)

To use a custom domain (e.g., `proposal.yourcompany.com`):

1. In Settings > Pages, scroll to "Custom domain"
2. Enter your domain and click **Save**
3. GitHub will provide DNS records to add to your domain registrar
4. Wait 24 hours for DNS propagation
5. GitHub will auto-enable HTTPS once the domain is verified

## Additional Resources

- [GitHub Pages Docs](https://docs.github.com/en/pages)
- [Configuring a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)
- [Using Jekyll with GitHub Pages](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll) (not needed for this static site)
