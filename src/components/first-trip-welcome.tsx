import { BrandGlowCard, MascotImage } from "@/components/mascot";
import { NewTripButton } from "@/components/new-trip-button";

const FIRST_STEPS = [
  { title: "Create a trip", body: "Where, when and who’s coming." },
  { title: "Add what you’ve booked", body: "Flights, stays and reservations, with confirmation numbers." },
  { title: "Plan, pack and remember", body: "Day-by-day plans, a shared packing list, and a journal of moments." },
];

/** Dashboard onboarding when the traveler has no trips yet. */
export function FirstTripWelcome() {
  return (
    <BrandGlowCard className="mt-10 grid items-center gap-6 p-6 sm:p-10 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-10">
      <div className="flex justify-center">
        <MascotImage size="lg" variant="glow" priority />
      </div>
      <div>
        <p className="eyebrow text-moss-ink">Welcome to Atlas</p>
        <h2 className="font-display mt-2 text-3xl leading-tight font-semibold text-ink sm:text-[2.25rem]">
          Let’s plant your first trip.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Atlas is your family’s travel garden — every trip you add grows into plans, packing lists and memories
          you can come back to.
        </p>
        <ol className="mt-6 space-y-3">
          {FIRST_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gold-soft text-sm font-semibold text-gold-ink">
                {i + 1}
              </span>
              <span className="text-[0.9375rem]">
                <span className="font-semibold text-ink">{step.title}</span>
                <span className="text-muted-foreground"> — {step.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-7">
          <NewTripButton label="Create your first trip" />
        </div>
      </div>
    </BrandGlowCard>
  );
}
