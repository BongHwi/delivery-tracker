import { type Logger } from "winston";
import {
  Carrier,
  type CarrierTrackInput,
  type TrackInfo,
  type TrackEvent,
  TrackEventStatusCode,
} from "../../core";
import { rootLogger } from "../../logger";
import { BadRequestError, NotFoundError } from "../../core/errors";
import { DateTime } from "luxon";
import { type CarrierUpstreamFetcher } from "../../carrier-upstream-fetcher/CarrierUpstreamFetcher";

const carrierLogger = rootLogger.child({
  carrierId: "dev.track.dummy",
});

/**
 * Dummy carrier for testing purposes.
 *
 * Valid tracking numbers:
 * - "DELIVERED" - Returns a package that was delivered
 * - "IN_TRANSIT" - Returns a package currently in transit
 * - "OUT_FOR_DELIVERY" - Returns a package out for delivery
 * - "EXCEPTION" - Returns a package with an exception
 * - "NOT_FOUND" - Throws NotFoundError
 * - Any other value - Throws BadRequestError
 */
export class DummyCarrier extends Carrier {
  readonly carrierId = "dev.track.dummy";
  readonly name = "Dummy Carrier (Testing Only)";

  public async track(input: CarrierTrackInput): Promise<TrackInfo> {
    return await new DummyCarrierTrackScraper(
      this.upstreamFetcher,
      input.trackingNumber
    ).track();
  }
}

class DummyCarrierTrackScraper {
  private readonly logger: Logger;

  constructor(
    readonly upstreamFetcher: CarrierUpstreamFetcher,
    readonly trackingNumber: string
  ) {
    this.logger = carrierLogger.child({ trackingNumber });
  }

  public async track(): Promise<TrackInfo> {
    this.logger.debug("Tracking dummy package", {
      trackingNumber: this.trackingNumber,
    });

    const tn = this.trackingNumber.toUpperCase();

    // Simulate different scenarios based on tracking number
    switch (tn) {
      case "NOT_FOUND":
        throw new NotFoundError("Package not found in system");

      case "DELIVERED":
        return this.createDeliveredPackage();

      case "IN_TRANSIT":
        return this.createInTransitPackage();

      case "OUT_FOR_DELIVERY":
        return this.createOutForDeliveryPackage();

      case "EXCEPTION":
        return this.createExceptionPackage();

      default:
        throw new BadRequestError("Invalid tracking number for dummy carrier");
    }
  }

  private createDeliveredPackage(): TrackInfo {
    const now = DateTime.now();
    const events: TrackEvent[] = [
      {
        status: {
          code: TrackEventStatusCode.InformationReceived,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 3 }),
        location: {
          name: "Seoul Distribution Center",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Shipment information received",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.AtPickup,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 3, hours: 2 }),
        location: {
          name: "Seoul Distribution Center",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Package picked up",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.InTransit,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 2 }),
        location: {
          name: "Incheon Hub",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "In transit to destination",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.OutForDelivery,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 1 }),
        location: {
          name: "Gangnam Delivery Center",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Out for delivery",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.Delivered,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ hours: 2 }),
        location: {
          name: "Gangnam-gu, Seoul",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Delivered - Left at front door",
        contact: {
          name: "John Doe",
          location: null,
          phoneNumber: null,
          carrierSpecificData: new Map(),
        },
        carrierSpecificData: new Map(),
      },
    ];

    return {
      events,
      sender: {
        name: "Test Sender Co.",
        location: {
          name: "Seoul",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      recipient: {
        name: "Test Recipient",
        location: {
          name: "Seoul, Gangnam-gu",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      carrierSpecificData: new Map([
        ["dev.track.dummy.scenario", "DELIVERED"],
        ["dev.track.dummy.packageType", "Standard"],
        ["dev.track.dummy.weight", "2.5kg"],
      ]),
    };
  }

  private createInTransitPackage(): TrackInfo {
    const now = DateTime.now();
    const events: TrackEvent[] = [
      {
        status: {
          code: TrackEventStatusCode.InformationReceived,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 2 }),
        location: {
          name: "Origin Facility",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Shipment information received",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.AtPickup,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 2, hours: 3 }),
        location: {
          name: "Origin Facility",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Package picked up",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.InTransit,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ hours: 5 }),
        location: {
          name: "Transit Hub",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Package is in transit",
        contact: null,
        carrierSpecificData: new Map(),
      },
    ];

    return {
      events,
      sender: {
        name: "Test Sender",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      recipient: {
        name: "Test Recipient",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      carrierSpecificData: new Map([
        ["dev.track.dummy.scenario", "IN_TRANSIT"],
        ["dev.track.dummy.estimatedDelivery", now.plus({ days: 1 }).toISO() ?? ""],
      ]),
    };
  }

  private createOutForDeliveryPackage(): TrackInfo {
    const now = DateTime.now();
    const events: TrackEvent[] = [
      {
        status: {
          code: TrackEventStatusCode.InformationReceived,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 1 }),
        location: {
          name: "Distribution Center",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Shipment information received",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.InTransit,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ hours: 12 }),
        location: {
          name: "Local Hub",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Arrived at local facility",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.OutForDelivery,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ hours: 2 }),
        location: {
          name: "Delivery Vehicle",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Out for delivery - Expected today",
        contact: null,
        carrierSpecificData: new Map(),
      },
    ];

    return {
      events,
      sender: {
        name: "Test Sender",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      recipient: {
        name: "Test Recipient",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      carrierSpecificData: new Map([
        ["dev.track.dummy.scenario", "OUT_FOR_DELIVERY"],
        ["dev.track.dummy.deliveryDriver", "Driver #42"],
      ]),
    };
  }

  private createExceptionPackage(): TrackInfo {
    const now = DateTime.now();
    const events: TrackEvent[] = [
      {
        status: {
          code: TrackEventStatusCode.InformationReceived,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 3 }),
        location: {
          name: "Origin",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Shipment information received",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.InTransit,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ days: 2 }),
        location: {
          name: "Transit Center",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "In transit",
        contact: null,
        carrierSpecificData: new Map(),
      },
      {
        status: {
          code: TrackEventStatusCode.Exception,
          name: null,
          carrierSpecificData: new Map(),
        },
        time: now.minus({ hours: 6 }),
        location: {
          name: "Sorting Facility",
          countryCode: "KR",
          postalCode: null,
          carrierSpecificData: new Map(),
        },
        description: "Delivery exception - Address needs clarification",
        contact: null,
        carrierSpecificData: new Map(),
      },
    ];

    return {
      events,
      sender: {
        name: "Test Sender",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      recipient: {
        name: "Test Recipient",
        location: null,
        phoneNumber: null,
        carrierSpecificData: new Map(),
      },
      carrierSpecificData: new Map([
        ["dev.track.dummy.scenario", "EXCEPTION"],
        ["dev.track.dummy.exceptionReason", "Address incomplete"],
        ["dev.track.dummy.actionRequired", "Contact customer service"],
      ]),
    };
  }
}
