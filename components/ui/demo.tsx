import { Hero04, type Hero04Props } from '@/components/ui/hero-04'

const values = {
  title: 'DCPH Annual Block Screenings',
  titleLine2: 'Movie 29 Cinema Event • SM North EDSA',
  description:
    'Gathering Filipino Conan fans for grand cinema screenings at SM North EDSA with exclusive merch, cosplay, raffle prizes, and premiere celebrations.',
  washImage:
    '/Bs2026.jpg',
  primaryImage:
    '/Bs2026.jpg',
  secondaryImage:
    '/hero-image.jpg',
  primaryAlt: 'DCPH Movie 29 Block Screening Poster',
  secondaryAlt: 'Conan Fan Gathering',
  animation: 'subtle',
  primaryCTA: {
    ctaEnabled: true,
    text: 'Register for Block Screening',
    link: 'https://www.facebook.com/groups/dcphanimeandmanga/permalink/3448422521992339',
    variant: 'default',
    size: 'default',
  },
  secondaryCTA: {
    ctaEnabled: true,
    text: 'See More',
    link: 'https://www.facebook.com/groups/1506883556146255',
    variant: 'link',
  },
} satisfies Hero04Props

export default function Hero04Demo() {
  return <Hero04 {...values} />
}
