# Deployment & Cost Guardrails Guide

## 1. Firebase Project Setup
Before deploying to production, initialize your Firebase project association:
```bash
firebase login
firebase use --add
```
Select or create your Firebase project. Note that **Cloud Functions (2nd Gen) requires the Firebase Blaze (Pay-as-you-go) plan** because it runs on Google Cloud Run. For personal use, costs are typically \$0 under the free monthly tier (2 million invocations/month).

## 2. Google Cloud Budget Alerts (Cost Protection)
To ensure no runaway costs occur:
1. Open the [Google Cloud Console Billing Budgets](https://console.cloud.google.com/billing/budgets).
2. Create a budget for your project with a target of **\$1.00** or **\$5.00**.
3. Set alert thresholds at:
   - 50% (\$0.50)
   - 90% (\$0.90)
   - 100% (\$1.00)
4. Enable email alerts to your account.

## 3. Artifact Registry Cleanup Policy
Cloud Functions stores container build images in Google Cloud Artifact Registry, which charges pennies for storage if unmaintained. To keep storage free:
1. Navigate to Artifact Registry in the GCP Console.
2. Under the repository `gcf-artifacts`, configure a **Cleanup Policy** to automatically delete untagged or images older than 7 days.

## 4. Deploying to Firebase
Build the frontend and deploy hosting and functions:
```bash
npm run build
cd functions && npm run build && cd ..
firebase deploy
```

If you only want to deploy Cloud Functions:
```bash
firebase deploy --only functions
```

If you only want to deploy the frontend:
```bash
firebase deploy --only hosting
```

## 5. Automated CI/CD with GitHub Actions
The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that automatically builds, tests, typechecks, and deploys to Firebase Hosting whenever changes are committed/merged into the `main` branch.

### Required GitHub Secrets & Variables
To enable automated deployments, navigate to your GitHub repository:
**Settings** -> **Secrets and variables** -> **Actions**

1. **`FIREBASE_SERVICE_ACCOUNT`** (Secret - Required):
   - A Google Cloud Service Account key in JSON format.
   - **How to create:**
     - Open [Google Cloud Console > IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) for your Firebase project.
     - Select or create a service account (e.g. `github-action-deployer`).
     - Grant the **Firebase Hosting Admin** role (and **Cloud Functions Developer** if deploying functions).
     - Under the **Keys** tab, click **Add Key** > **Create new key** > **JSON**.
     - Download the JSON file and paste its entire content into the `FIREBASE_SERVICE_ACCOUNT` GitHub secret.
     *(Alternatively, running `firebase init hosting:github` locally will configure this service account and secret automatically).*

2. **`FIREBASE_PROJECT_ID`** (Secret or Variable - Required):
   - Your Firebase Project ID (e.g., `my-chords-app`).

