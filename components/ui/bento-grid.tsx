import { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const BentoGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "grid w-full auto-rows-[13rem] sm:auto-rows-[14rem] lg:auto-rows-[16rem] grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
};

const BentoCard = ({
  name,
  className,
  background,
  Icon,
  description,
  href,
  cta,
  badge,
  date,
}: {
  name: string;
  className?: string;
  background?: ReactNode;
  Icon?: any;
  description?: string;
  href?: string;
  cta?: string;
  badge?: string;
  date?: string;
}) => (
  <div
    key={name}
    className={cn(
      "group relative flex flex-col justify-between overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200 bg-surface p-4 sm:p-6 shadow-card transition-all duration-300 hover:shadow-xl hover:border-slate-300",
      className,
    )}
  >
    {/* Background element / image */}
    <div className="absolute inset-0 z-0 overflow-hidden">{background}</div>

    {/* Header badges */}
    <div className="relative z-10 flex items-center justify-between gap-2">
      {badge && (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-0.5 sm:px-3 sm:py-1 font-mono text-[10px] sm:text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm">
          {badge}
        </span>
      )}
      {date && (
        <span className="font-mono text-[10px] sm:text-xs text-slate-700 bg-white/85 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full shadow-sm backdrop-blur-sm">
          {date}
        </span>
      )}
    </div>

    {/* Content Area */}
    <div className="relative z-10 flex transform-gpu flex-col gap-1.5 sm:gap-2 transition-all duration-300 group-hover:-translate-y-1 mt-auto">
      {Icon && (
        <span className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg sm:rounded-xl bg-white/90 text-slate-800 shadow-sm backdrop-blur-md transition-all duration-300 group-hover:scale-110">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
      )}
      <h3 className="text-base sm:text-xl font-bold font-display text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] leading-snug">
        {name}
      </h3>
      {description && (
        <p className="text-xs sm:text-sm font-body text-slate-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] line-clamp-2">
          {description}
        </p>
      )}
    </div>

    {/* Hover CTA Link */}
    {href && cta && (
      <div className="relative z-10 mt-2 sm:mt-3 pt-1 sm:pt-2">
        <a
          href={href}
          className="inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-all group-hover:gap-2 sm:group-hover:gap-2.5"
        >
          {cta}
          <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 transition-transform group-hover:translate-x-1" />
        </a>
      </div>
    )}

    {/* Static subtle bottom gradient (No black hover effect) */}
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 z-[1] bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
  </div>
);

export { BentoCard, BentoGrid };
