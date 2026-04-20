export interface AggregatedCourt {
  club: 'alpha' | 'nbc' | 'pro1' | 'roketto';
  location: string;
  locationId: string;
  address: string;
  suburb: string;
  courtName: string;
  courtId: string;
  timeSlot: string;
  status: 'available' | 'booked' | 'past';
  price: number;
  date: string;
}
