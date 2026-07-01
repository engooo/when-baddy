export interface AggregatedCourt {
  club: 'alpha' | 'nbc' | 'pro1' | 'roketto' | 'picklepoint' | 'mindbody';
  sport?: 'badminton' | 'pickleball';
  location: string;
  locationId: string;
  address: string;
  suburb: string;
  courtName: string;
  courtId: string;
  courtType?: 'casual' | 'show';
  timeSlot: string;
  status: 'available' | 'booked' | 'past';
  price: number;
  date: string;
}

export type SportMode = 'grid' | 'map';
