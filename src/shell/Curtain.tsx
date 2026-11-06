// The signer pages' dark curtain (a unique background, Design Log Nov 5): the Join page and Sign-in › Too many tries.
import { BrandImg } from "../ui/BrandImg";
import { Icon } from "../ui/Icon";
import smear from "../assets/portal/light-smear.jpg";

export function Curtain({ legal, children }: { legal: string; children: React.ReactNode }) {
  return (
    <div className="wsx gst">
      <div className="wp-light signing" aria-hidden><i style={{ backgroundImage: `url(${smear})` }} /></div>
      <header className="wsx-top"><BrandImg name="wordmark" alt="WranglerPortal" /><span className="wsx-secure"><Icon name="lock" size={14} />Secure sign-in</span></header>
      <main className="wsx-main">{children}</main>
      <footer className="wsx-foot">{legal ? `${legal} · ` : ""}Questions? Reply to the email that brought you here.</footer>
    </div>
  );
}

