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
  const [isMuted, setIsMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
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
        setIsPlaying(true);
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
      className="relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-xl transition-all duration-500"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 min-h-[460px] items-center p-6 sm:p-10 lg:p-12 gap-8">
        {/* Left Column: Aligned Text Content */}
        <div className="lg:col-span-5 flex flex-col justify-between h-full space-y-6">
          <div className="space-y-4">
            {/* Header Badge & Location Alignment */}
            <div
              className={`flex items-center justify-between gap-3 border-b border-slate-100 pb-4 transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-slate-500">
                  {String(currentIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
                </span>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1 font-mono text-xs font-semibold text-amber-700">
                <MapPin className="w-3.5 h-3.5 text-amber-600" />
                SM North EDSA
              </span>
            </div>

            {/* Title */}
            <h2
              className={`font-display text-2xl sm:text-3xl font-bold leading-tight tracking-tight text-slate-900 transition-all duration-500 ${
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
              <span className="inline-block rounded-md border border-slate-200 bg-slate-100 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-slate-700">
                {currentSlide.subtitle}
              </span>
            </div>

            {/* Description */}
            <p
              className={`font-body text-sm leading-relaxed text-slate-600 transition-all duration-500 ${
                isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'
              }`}
            >
              {currentSlide.description}
            </p>
          </div>

          {/* Navigation Arrows */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-6">
            <div className="flex items-center gap-3">
              <button
                onClick={goPrev}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-800 shadow-sm transition-all hover:bg-slate-900 hover:text-white hover:scale-105 active:scale-95"
                aria-label="Previous slide"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button
                onClick={goNext}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-800 shadow-sm transition-all hover:bg-slate-900 hover:text-white hover:scale-105 active:scale-95"
                aria-label="Next slide"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Media Container with Timeframe Seeker */}
        <div className="lg:col-span-7 relative h-full w-full min-h-[320px] sm:min-h-[400px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 shadow-lg">
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
                  autoPlay
                  playsInline
                  muted={isMuted}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleTimeUpdate}
                  onEnded={handleVideoEnded}
                  className="h-full w-full object-cover"
                />

                {/* Video Timeframe Seeker Bar & Audio Controls Overlay */}
                <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/40 to-transparent p-4 flex flex-col gap-2">
                  {/* Interactive Timeframe Slider */}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.1"
                    value={progress}
                    onChange={handleSeek}
                    className="w-full h-1.5 accent-red-600 bg-white/30 rounded-lg cursor-pointer appearance-none hover:h-2 transition-all"
                  />

                  <div className="flex items-center justify-between text-white text-xs font-mono">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow hover:scale-105"
                        aria-label={isPlaying ? 'Pause video' : 'Play video'}
                      >
                        {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
                      </button>
                      <span className="text-slate-200">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={toggleMute}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow hover:scale-105"
                      aria-label={isMuted ? 'Unmute sound' : 'Mute sound'}
                    >
                      {isMuted ? (
                        <VolumeX className="h-3.5 w-3.5 text-red-600" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5 text-emerald-600" />
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

      {/* Bottom Slide Navigation Tabs (3 BS Highlights, smaller font sizing) */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-200 bg-slate-50 p-4">
        {slides.map((slide, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`flex flex-col items-start gap-2 p-2.5 rounded-xl text-left transition-all ${
              index === currentIndex
                ? 'bg-white border border-slate-300 shadow-sm'
                : 'hover:bg-slate-100 opacity-80 border border-transparent'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          >
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-slate-800 transition-all duration-150 rounded-full"
                style={{
                  width: index === currentIndex ? `${progress}%` : index < currentIndex ? '100%' : '0%',
                }}
              />
            </div>
            <span className="font-display text-[11px] font-semibold text-slate-800 truncate max-w-full">
              {slide.title}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
