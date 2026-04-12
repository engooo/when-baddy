export interface AggregatedCourt {
  club: 'alpha' | 'nbc';
  location: string;
  locationId: string;
  courtName: string;
  courtId: string;
  timeSlot: string;
  status: 'available' | 'booked' | 'past';
  price: number;
  date: string;
}
