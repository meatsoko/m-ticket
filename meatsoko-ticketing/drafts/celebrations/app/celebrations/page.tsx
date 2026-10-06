import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { getCelebrationData } from "@/lib/celebrations";

export const metadata = { title: "Celebrations · MeatSoko" };

export default async function CelebrationsPage() {
  const { occasions } = await getCelebrationData();

  return (
    <AppShell>
      <section className="celeb-hero">
        <div className="pad">
          <span className="eyebrow">MEATSOKO CELEBRATIONS</span>
          <h1>Make it unforgettable<span>.</span></h1>
          <p className="large">From birthdays to graduations, we handle the meat and the vibes while you focus on the memories.</p>
        </div>
      </section>

      <div className="pad">
        <div className="occasion-grid">
          {occasions.map((o) => (
            <Link key={o.id} href={`/celebrations/book?occasion=${o.slug}`} className="occasion-card">
              <div className="occasion-icon">
                {/* Simplified icon handling: assuming Icon component can take these names or fallback */}
                <Icon name="sparkles" size={32} />
              </div>
              <h3>{o.name}</h3>
              <p className="small">Plan your {o.name.toLowerCase()} celebration</p>
              <span className="celeb-btn">Start planning <span>→</span></span>
            </Link>
          ))}
        </div>

        <section className="lipa-mdogo-promo">
          <div className="card glass">
            <div className="promo-content">
              <h2>Lipa Mdogo Mdogo</h2>
              <p>Don&apos;t let the budget stop the party. Pay a small deposit today and clear the balance in flexible installments leading up to your big day.</p>
              <ul className="small">
                <li>✅ 25% minimum deposit</li>
                <li>✅ Flexible payment schedule</li>
                <li>✅ Real-time balance tracking</li>
                <li>✅ Automated reminders</li>
              </ul>
            </div>
            <div className="promo-visual">
              <div className="progress-mock">
                <span>Goal: KSh 30,000</span>
                <div className="progress-bar"><div style={{ width: "65%" }} /></div>
                <strong>65% Paid</strong>
              </div>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .celeb-hero { padding: 4rem 0 2rem; text-align: center; }
        .celeb-hero h1 { font-size: 3rem; margin: 1rem 0; }
        .celeb-hero p { max-width: 600px; margin: 0 auto; opacity: 0.8; }

        .occasion-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; margin: 2rem 0 4rem; }
        .occasion-card { padding: 2rem; background: white; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px; text-decoration: none; color: inherit; transition: all 0.2s ease; }
        .occasion-card:hover { transform: translateY(-4px); border-color: var(--brand-red, #c62a33); box-shadow: 0 12px 24px rgba(0,0,0,0.05); }
        
        .occasion-icon { width: 64px; height: 64px; background: rgba(198, 42, 51, 0.05); color: var(--brand-red, #c62a33); border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
        .occasion-card h3 { font-size: 1.25rem; margin-bottom: 0.5rem; }
        .occasion-card p { opacity: 0.6; margin-bottom: 1.5rem; }
        
        .celeb-btn { font-size: 0.9rem; font-weight: 700; color: var(--brand-red, #c62a33); display: flex; align-items: center; gap: 8px; }

        .lipa-mdogo-promo { margin-bottom: 6rem; }
        .lipa-mdogo-promo .card { display: grid; grid-template-columns: 1.5fr 1fr; gap: 3rem; padding: 3rem; align-items: center; border-radius: 24px; background: #fafafa; border: none; }
        .promo-content h2 { font-size: 2rem; margin-bottom: 1rem; }
        .promo-content p { margin-bottom: 1.5rem; opacity: 0.8; }
        .promo-content ul { list-style: none; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        
        .progress-mock { background: white; padding: 2rem; border-radius: 16px; box-shadow: 0 8px 16px rgba(0,0,0,0.05); }
        .progress-bar { height: 12px; background: #eee; border-radius: 6px; margin: 1rem 0; overflow: hidden; }
        .progress-bar div { height: 100%; background: var(--brand-green, #1f6b3a); border-radius: 6px; }

        @media (max-width: 800px) {
          .celeb-hero h1 { font-size: 2.25rem; }
          .lipa-mdogo-promo .card { grid-template-columns: 1fr; gap: 2rem; padding: 2rem; }
          .promo-content ul { grid-template-columns: 1fr; }
        }
      `}</style>
    </AppShell>
  );
}
