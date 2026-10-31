import Link from "next/link";

export const metadata = {
  title: "Privacy Policy | Klyp",
  description: "How Klyp handles account, video, and YouTube publishing data.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <article className="mx-auto max-w-3xl space-y-7 text-sm leading-7 text-foreground-muted">
        <Link href="/" className="text-accent hover:underline">← Klyp home</Link>
        <header>
          <h1 className="font-syne text-3xl font-bold text-foreground">Privacy Policy</h1>
          <p>Effective October 31, 2026</p>
        </header>
        <section>
          <h2 className="text-lg font-semibold text-foreground">Information Klyp handles</h2>
          <p>Klyp uses account information to sign you in and provide your subscription. When you submit a video link or upload a file, Klyp processes the video, audio, transcript, clip choices, and edits to find, save, and export clips. We also keep records needed to show your clips, usage, and account status.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-foreground">YouTube connection and publishing</h2>
          <p>If you choose Connect YouTube, Google asks you to authorize Klyp to upload videos to your YouTube channel. Klyp uses the YouTube upload permission only when you ask Klyp to post or schedule a clip. Klyp stores the authorization refresh token encrypted so you can publish without connecting again for every clip. Klyp also stores the clip and post details you submit, the scheduled time, upload status, and YouTube video ID. Scheduled clips are uploaded as private videos with a future publish time set on YouTube. Clips you choose to post immediately are uploaded as public videos.</p>
          <p>You can disconnect YouTube in Klyp&apos;s publishing dialog. Klyp revokes the Google authorization and removes its stored token. Existing post records remain in your Klyp account after disconnecting; contact us to request their deletion. Disconnecting does not delete videos already on YouTube. You can also revoke Klyp&apos;s access in your Google Account settings.</p>
          <p>Klyp does not sell Google user data, use it for advertising, or use your YouTube authorization data to train AI models. Klyp uses Google user data only to provide the YouTube publishing feature you request, subject to the <a className="text-accent hover:underline" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-foreground">Service providers and security</h2>
          <p>Klyp uses service providers for account authentication, hosting, video storage and processing, transcription, AI clip analysis, and subscription payments. Information needed for those services is sent to the relevant provider to deliver the feature you use. Klyp restricts access to stored YouTube authorization tokens and encrypts them before storage. No internet service can guarantee absolute security.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-foreground">Your choices</h2>
          <p>You can choose whether to connect YouTube, which clips to publish, and whether to disconnect your channel. To ask about your data, request access, or request deletion of account or post records, email <a className="text-accent hover:underline" href="mailto:iitsmikez@gmail.com">iitsmikez@gmail.com</a>. We may need to verify that you own the account before fulfilling a request. We may keep records where required for security, billing, or legal obligations.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-foreground">Updates</h2>
          <p>We may update this policy as Klyp changes. The effective date above shows when this version took effect. For privacy questions, contact <a className="text-accent hover:underline" href="mailto:iitsmikez@gmail.com">iitsmikez@gmail.com</a>.</p>
        </section>
      </article>
    </main>
  );
}
