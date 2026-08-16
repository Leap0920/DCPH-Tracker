"use client";

import { ReactNode } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

const gridVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1 },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

const BentoGrid = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? "show" : "hidden"}
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
      variants={gridVariants}
      className={cn(
        "grid w-full auto-rows-[8.5rem] min-[400px]:auto-rows-[9.5rem] sm:auto-rows-[11.5rem] md:auto-rows-[12.5rem] lg:auto-rows-[13.5rem] grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3.5 lg:gap-4.5",
        className,
      )}
    >
      {children}
    </motion.div>
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
}) => {
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={name}
      variants={cardVariants}
      whileHover={
        reduce
          ? undefined
          : { y: -5, transition: { type: "spring", stiffness: 300, damping: 22 } }
      }
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-xl sm:rounded-2xl border border-slate-200/60 bg-surface p-2.5 sm:p-4 shadow-card transition-[box-shadow,border-color] duration-300 hover:shadow-xl hover:border-slate-300",
        className,
      )}
    >
      {/* Background element / image */}
      <div className="absolute inset-0 z-0 overflow-hidden">{background}</div>

      {/* Header badges */}
      <div className="relative z-10 flex items-center justify-between gap-1">
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 sm:px-2.5 sm:py-1 font-mono text-[8.5px] min-[400px]:text-[9.5px] sm:text-xs font-semibold text-ink shadow-sm backdrop-blur-sm truncate max-w-[55%]">
            {badge}
          </span>
        )}
        {date && (
          <span className="font-mono text-[8.5px] min-[400px]:text-[9.5px] sm:text-xs text-ink-dim bg-white/85 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full shadow-sm backdrop-blur-sm shrink-0">
            {date}
          </span>
        )}
      </div>

      {/* Content Area */}
      <div className="relative z-10 flex transform-gpu flex-col gap-0.5 sm:gap-1 transition-all duration-300 group-hover:-translate-y-1 mt-auto">
        {Icon && (
          <span className="flex h-5 w-5 sm:h-8 sm:w-8 items-center justify-center rounded-md sm:rounded-lg bg-white/90 text-ink shadow-sm backdrop-blur-md transition-all duration-300 group-hover:scale-110 mb-0.5">
            <Icon className="h-2.5 w-2.5 sm:h-4 sm:w-4" />
          </span>
        )}
        <h3 className="text-[11px] min-[400px]:text-xs sm:text-base lg:text-lg font-bold font-display text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] leading-tight line-clamp-2">
          {name}
        </h3>
        {description && (
          <p className="hidden sm:block text-xs font-body text-slate-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] line-clamp-1">
            {description}
          </p>
        )}
        {href && cta && (
          <div className="pt-0.5">
            <a
              href={href}
              className="inline-flex items-center gap-1 text-[9.5px] min-[400px]:text-[10.5px] sm:text-xs font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] transition-all group-hover:gap-2"
            >
              {cta}
              <ArrowRight className="h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 transition-transform group-hover:translate-x-1" />
            </a>
          </div>
        )}
      </div>

      {/* Static subtle bottom gradient */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 z-[1] bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
    </motion.div>
  );
};

export { BentoCard, BentoGrid };
