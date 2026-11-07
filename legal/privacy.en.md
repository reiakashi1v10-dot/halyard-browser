# Halyard Browser Privacy Policy

**Last updated:** November 7, 2026

This policy explains what data Halyard Browser ("Halyard", "we") handles, why, and your rights, under Brazil's General Data Protection Law (LGPD, Law 13.709/2018) and other applicable laws.

**Data controller:** Yan, the developer of Halyard.
**Privacy contact (DPO):** halyardbrowser@gmail.com

## 1. In short

- **Your history, bookmarks, tabs, typed passwords and downloads stay on your computer.** Halyard has no server that receives what you browse.
- **We don't sell, rent or share data for advertising.** Halyard has no ads and no trackers of its own.
- **An account is optional.** Without one, Halyard sends us no personal data at all.

## 2. Data that stays on your computer only

History, bookmarks, tabs and spaces, settings, site permissions, the downloads list, cookies and site data, and the local AI model (with everything you say to it). This data lives in Halyard's folder in your Windows user profile. Cookies are stored encrypted. You can erase everything in **Settings › Privacy › Clear data**, or with the panic button.

## 3. Data we handle when you create an account

| Data | Purpose | Legal basis (LGPD) |
|---|---|---|
| Email | Identify the account, sign in, reset the password | Performance of a contract (art. 7, V) |
| Password | Sign in. Only a bcrypt hash is stored, never the password | Performance of a contract |
| Display name, language, theme | Sync your preferences across computers | Performance of a contract |
| Created and updated dates | Security and support | Legitimate interest (art. 7, IX) |

Accounts run on **Supabase** (Supabase Inc.) for sign-in and storage. Each person can only read and change their own row (row-level security). **No browsing data is sent to the account.**

## 4. Third-party services Halyard contacts

To work and to protect you, Halyard talks to a few services. None of them receives your history.

| Service | When | What it receives |
|---|---|---|
| **Secure DNS provider** (Cloudflare, Quad9 or Google, your choice) | Whenever you open a site | The site's name (this is how every browser finds an address). You can change or turn it off. |
| **Search engine** you picked (DuckDuckGo by default) | When you search, or as you type with suggestions on | What you type in the address bar |
| **Ghostery / block lists** | Once a day | Nothing personal: it only downloads the lists |
| **malware-filter (GitLab)** | Every 12 hours | Nothing personal: it only downloads the lists of dangerous sites |
| **Have I Been Pwned** | When you type a password on a site, if the check is on | Only the first 5 characters of the password's SHA-1 hash (k-anonymity). The password never leaves your computer. |
| **Google Translate** | Only when you ask to translate a page | The page address |
| **Hugging Face** | Only when you download the AI model | Nothing personal: it only downloads the file |
| **GitHub** | To look for Halyard updates | Nothing personal: the installed version is compared with the newest one |
| **Microsoft Defender** (on your PC) | When you download programs, scripts and archives | Defender runs on your computer and may check Microsoft's cloud, depending on your Windows settings |

Each service has its own policy. We recommend reading the ones you use.

## 5. How long we keep data

Account data is kept while the account exists. When you ask for deletion at the contact email, we delete the account and profile within 15 days. Local data stays on your computer until you erase it.

## 6. Your rights

You may ask at any time for confirmation that we process your data, access, correction, anonymization or deletion, portability, information about who we share it with, and withdrawal of consent. Write to **halyardbrowser@gmail.com**. We answer within 15 days. In Brazil you can also complain to the National Data Protection Authority (ANPD).

## 7. Security

We use encrypted connections (HTTPS and TLS 1.2 or newer), hashed passwords, cookies encrypted on disk, public access keys with row-level security in the database, and least privilege. No system is 100% secure. If an incident could cause you relevant risk or harm, we will tell you and the authorities.

## 8. Children

Halyard is not directed at children under 13, and we don't knowingly create accounts for them.

## 9. International transfers

Some providers (such as Supabase and the services in section 4) may process data outside Brazil. Those transfers follow art. 33 of the LGPD, with providers that offer adequate protection.

## 10. Changes

If this policy changes in a meaningful way, we will tell you inside the browser before the change takes effect. The date at the top shows the latest version.
