export interface TimeSlot {
  timeSlot: string; // e.g., "9:00am–10:00am"
  status: 'available' | 'booked' | 'past';
  price: number;
}

export interface Court {
  courtId: string;
  courtName: string;
  availability: TimeSlot[];
}

export interface Location {
  locationId: string;
  locationName: string;
  address: string;
  suburb: string;
  courts: Court[];
}

export interface CourtData {
  club: 'alpha' | 'nbc' | 'pro1' | 'roketto';
  date: string; // YYYY-MM-DD
  locations: Location[];
  scrapedAt: string; // ISO timestamp
}

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
