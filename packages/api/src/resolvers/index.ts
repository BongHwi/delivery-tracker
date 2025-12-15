import {
  QueryResolvers as CarrierQueryResolvers,
  CarrierResolvers,
} from "./carrier";
import {
  ContactInfoResolvers,
  LocationResolvers,
  QueryResolvers as TrackQueryResolvers,
  TrackEventResolvers,
  TrackInfoResolvers,
  TrackEventStatusResolvers,
  type TrackInfoContext,
  type TrackEventContext,
  type ContactInfoContext,
  type LocationContext,
} from "./track";
import { MutationResolvers } from "./webhook";

const resolvers = {
  Query: {
    ...CarrierQueryResolvers,
    ...TrackQueryResolvers,
  },
  Mutation: {
    ...MutationResolvers,
  },
  Carrier: {
    ...CarrierResolvers,
  },
  TrackInfo: {
    ...TrackInfoResolvers,
  },
  TrackEvent: {
    ...TrackEventResolvers,
  },
  TrackEventStatus: {
    ...TrackEventStatusResolvers,
  },
  ContactInfo: {
    ...ContactInfoResolvers,
  },
  Location: {
    ...LocationResolvers,
  },
};

export {
  resolvers,
  type TrackInfoContext,
  type TrackEventContext,
  type ContactInfoContext,
  type LocationContext,
};
