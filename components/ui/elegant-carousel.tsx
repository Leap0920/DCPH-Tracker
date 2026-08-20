'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Volume2, VolumeX, Play, Pause } from 'lucide-react';

export interface SlideData {
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  imageUrl?: string;
  videoUrl?: string;
  location?: string;
}

const defaultSlides: SlideData[] = [
  {
    title: 'Movie 28: One-eyed Flashback',
    subtitle: '2025 Cinema Block Screening',
    description:
      'Filipino Conan detectives gathered at SM North EDSA for the grand premiere of Movie 28 with exclusive fan kits and cosplay meetups.',
    accent: '#DC2626',
    videoUrl: '/videos/BS2025.mp4',
    imageUrl: '/img/shinichi.jpg',
    location: 'SM North EDSA',
  },
  {
    title: 'Movie 27: The Million-dollar Pentagram',
    subtitle: '2024 Cinema Block Screening',
    description:
      'Packed cinema halls at SM North EDSA celebrating Kid vs. Heiji hype with exclusive DCPH commemorative fan merchandise.',
    accent: '#8B5CF6',
    videoUrl: '/videos/BS2024.mp4',
    imageUrl: '/img/Jinpei.jpg',
    location: 'SM North EDSA',
  },
  {
    title: 'Movie 26: Black Iron Submarine',
    subtitle: '2023 Cinema Block Screening',
    description:
      'Full cinema takeover at SM North EDSA for Black Iron Submarine featuring official giveaways and community raffles.',
    accent: '#059669',
    videoUrl: '/videos/BS2023.mp4',
    imageUrl: '/img/Heiji.jpg',
    location: 'SM North EDSA',
  },
];

export default function ElegantCarousel({ customSlides }: { customSlides?: SlideData[] }) {
  const slides = customSlides || defaultSlides;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  const TRANSITION_DURATION = 500;
  const currentSlide = slides[currentIndex];

  const goToSlide = useCallback(
    (index: number) => {
      if (isTransitioning || index === currentIndex) return;
      setIsTransitioning(true);
      setProgress(0);

      setTimeout(() => {
        setCurrentIndex(index);
        setIsPlaying(false);
        setTimeout(() => {
          setIsTransitioning(false);
        }, 50);
      }, TRANSITION_DURATION / 2);
    },
    [isTransitioning, currentIndex]
  );

  const goNext = useCallback(() => {
    const nextIndex = (currentIndex + 1) % slides.length;
    goToSlide(nextIndex);
  }, [currentIndex, slides.length, goToSlide]);

  const goPrev = useCallback(() => {
    const prevIndex = (currentIndex - 1 + slides.length) % slides.length;
    goToSlide(prevIndex);
  }, [currentIndex, slides.length, goToSlide]);

  // Video time update and duration tracking
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      const dur = videoRef.current.duration;
      setCurrentTime(cur);
      if (dur && !isNaN(dur)) {
        setDuration(dur);
        setProgress((cur / dur) * 100);
      }
    }
  };

  // Video timeline seeking handler
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current && videoRef.current.duration) {
      const newTime = (val / 100) * videoRef.current.duration;
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      setProgress(val);
    }
  };

  // Video finished playing -> trigger next slide automatically
  const handleVideoEnded = () => {
    goNext();
  };

  // Sound toggle
  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  // Play/Pause toggle
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  // Image slide fallback timer (if no videoUrl present)
  useEffect(() => {
    if (currentSlide.videoUrl) return;

    const imageDuration = 6000;
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 100;
        return prev + 100 / (imageDuration / 50);
      });
    }, 50);

    const timer = setTimeout(() => {
      goNext();
    }, imageDuration);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [currentIndex, currentSlide.videoUrl, goNext]);

  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec === 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    const diff = touchStartX.current - touchEndX.current;
    if (Math.abs(diff) > 60) {
      if (diff > 0) goNext();
      else goPrev();
    }
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-line bg-surface text-ink shadow-card transition-all duration-500"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 min-h-0 lg:min-h-[460px] items-center p-4 sm:p-8 lg:p-12 gap-6 sm:gap-8">
        {/* Left Column: Aligned Text Content */}
        <div className="lg:col-span-5 flex flex-col justify-between h-full space-y-4 sm:space-y-6">
          <div className="space-y-3 sm:space-y-4">
            {/* Header Badge & Location Alignment */}
            <div
              className={`flex items-center justify-between gap-2 sm:gap-3 border-b border-line/60 pb-3 sm:pb-4 transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
              }`}
            >
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-accent animate-pulse" />
                <span className="font-mono text-[10px] sm:text-xs font-bold uppercase tracking-widest text-ink-faint">
                  {String(currentIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
                </span>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-gold-seal/30 bg-gold-seal/10 px-2.5 py-0.5 sm:px-3 sm:py-1 font-mono text-[10px] sm:text-xs font-semibold text-gold-seal">
                <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-gold-seal" />
                SM North EDSA
              </span>
            </div>

            {/* Title */}
            <h2
              className={`font-display text-lg sm:text-2xl lg:text-3xl font-bold leading-tight tracking-tight text-ink transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
              }`}
            >
              {currentSlide.title}
            </h2>

            {/* Subtitle Badge */}
            <div
              className={`inline-block transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
              }`}
            >
              <span className="inline-block rounded-md border border-line bg-surface-muted px-2.5 py-0.5 sm:px-3 sm:py-1 font-mono text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-ink-dim">
                {currentSlide.subtitle}
              </span>
            </div>

            {/* Description */}
            <p
              className={`font-body text-xs sm:text-sm leading-relaxed text-ink-dim transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
              }`}
            >
              {currentSlide.description}
            </p>
          </div>

          {/* Navigation Arrows */}
          <div className="flex items-center justify-between border-t border-line/60 pt-4 sm:pt-6">
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={goPrev}
                className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-line bg-surface-muted text-ink shadow-sm transition-all hover:bg-ink hover:text-page hover:scale-105 active:scale-95"
                aria-label="Previous slide"
              >
                <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
              <button
                onClick={goNext}
                className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border border-line bg-surface-muted text-ink shadow-sm transition-all hover:bg-ink hover:text-page hover:scale-105 active:scale-95"
                aria-label="Next slide"
              >
                <ArrowRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Media Container with Timeframe Seeker */}
        <div className="lg:col-span-7 relative h-full w-full min-h-[200px] sm:min-h-[320px] lg:min-h-[400px] overflow-hidden rounded-xl sm:rounded-2xl border border-line bg-black shadow-card">
          <div
            className={`h-full w-full transition-all duration-500 ease-out ${
              isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
            }`}
          >
            {currentSlide.videoUrl ? (
              <div className="relative h-full w-full group">
                <video
                  ref={videoRef}
                  key={currentSlide.videoUrl}
                  src={currentSlide.videoUrl}
                  playsInline
                  muted={isMuted}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleTimeUpdate}
                  onEnded={handleVideoEnded}
                  className="h-full w-full object-cover min-h-[200px]"
                />

                {/* Video Timeframe Seeker Bar & Audio Controls Overlay */}
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-2.5 sm:p-4 flex flex-col gap-1.5 sm:gap-2">
                  {/* Interactive Timeframe Slider */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={progress}
                    onChange={handleSeek}
                    className="w-full h-1 sm:h-1.5 accent-accent bg-white/30 rounded-lg cursor-pointer appearance-none hover:h-2 transition-all"
                  />

                  <div className="flex items-center justify-between text-white text-[10px] sm:text-xs font-mono">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-white/90 text-black shadow hover:scale-105"
                        aria-label={isPlaying ? 'Pause video' : 'Play video'}
                      >
                        {isPlaying ? <Pause className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-current" /> : <Play className="h-3 w-3 sm:h-3.5 sm:w-3.5 fill-current ml-0.5" />}
                      </button>
                      <span className="text-white/80">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={toggleMute}
                      className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-full bg-white/90 text-black shadow hover:scale-105"
                      aria-label={isMuted ? 'Unmute sound' : 'Mute sound'}
                    >
                      {isMuted ? (
                        <VolumeX className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-accent" />
                      ) : (
                        <Volume2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-success" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <img
                src={currentSlide.imageUrl}
                alt={currentSlide.title}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        </div>
      </div>

      {/* Bottom Slide Navigation Tabs */}
      <div className="relative z-10 grid grid-cols-3 gap-1.5 sm:gap-3 border-t border-line bg-surface-muted p-2.5 sm:p-4">
        {slides.map((slide, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`flex flex-col items-start gap-1 sm:gap-2 p-1.5 sm:p-2.5 rounded-lg sm:rounded-xl text-left transition-all ${
              index === currentIndex
                ? 'bg-surface border border-line shadow-sm'
                : 'hover:bg-surface-muted opacity-80 border border-transparent'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          >
            <div className="h-1 sm:h-1.5 w-full overflow-hidden rounded-full bg-ink-dim/15">
              <div
                className="h-full bg-ink transition-all duration-150 rounded-full"
                style={{
                  width: index === currentIndex ? `${progress}%` : index < currentIndex ? '100%' : '0%',
                }}
              />
            </div>
            <span className="font-display text-[9px] sm:text-[11px] font-semibold text-ink truncate max-w-full">
              {slide.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}