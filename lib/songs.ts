export interface Song {
  id: string;
  title: string;
  artist: string;
  file: string;
}

export const SONGS: Song[] = [
  {
    id: "the-nights",
    title: "The Nights",
    artist: "Avicii",
    file: "/midi/avicii-the-nights.mid",
  },
  {
    id: "wake-me-up",
    title: "Wake Me Up",
    artist: "Avicii",
    file: "/midi/avicii-wake-me-up.mid",
  },
  {
    id: "billie-jean",
    title: "Billie Jean",
    artist: "Michael Jackson",
    file: "/midi/billie-jean.mid",
  },
  {
    id: "bohemian-rhapsody",
    title: "Bohemian Rhapsody",
    artist: "Queen",
    file: "/midi/bohemian-rhapsody.mid",
  },
  {
    id: "i-want-it-that-way",
    title: "I Want It That Way",
    artist: "Backstreet Boys",
    file: "/midi/backstreet-boys-i-want-it-that-way.mid",
  },
  {
    id: "imagine",
    title: "Imagine",
    artist: "John Lennon",
    file: "/midi/john-lennon-imagine.mid",
  },
];
