import XCTest
@testable import RoachNetApp

final class RoachMapsSupportTests: XCTestCase {
    func testPhoneLocationParserReadsJSONPayload() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let fix = try RoachPhoneLocationPayloadParser.parse(
            """
            {"lat":39.76862,"lng":-86.15823,"accuracy":6.5,"speed":12.4,"heading":244,"altitude":218,"source":"RoachPhone"}
            """,
            now: now
        )

        XCTAssertEqual(fix.latitude, 39.76862, accuracy: 0.00001)
        XCTAssertEqual(fix.longitude, -86.15823, accuracy: 0.00001)
        XCTAssertEqual(fix.accuracyMeters, 6.5)
        XCTAssertEqual(fix.speedMetersPerSecond, 12.4)
        XCTAssertEqual(fix.courseDegrees, 244)
        XCTAssertEqual(fix.altitudeMeters, 218)
        XCTAssertEqual(fix.timestamp, now)
        XCTAssertEqual(fix.sourceName, "RoachPhone")
    }

    func testPhoneLocationParserReadsCSVPayload() throws {
        let fix = try RoachPhoneLocationPayloadParser.parse(
            "39.76862,-86.15823,7.5,10.2,370,218,1800000000,RoachPhone CSV"
        )

        XCTAssertEqual(fix.latitude, 39.76862, accuracy: 0.00001)
        XCTAssertEqual(fix.longitude, -86.15823, accuracy: 0.00001)
        XCTAssertEqual(fix.accuracyMeters, 7.5)
        XCTAssertEqual(fix.speedMetersPerSecond, 10.2)
        XCTAssertEqual(fix.courseDegrees, 10)
        XCTAssertEqual(fix.altitudeMeters, 218)
        XCTAssertEqual(fix.timestamp.timeIntervalSince1970, 1_800_000_000, accuracy: 0.1)
        XCTAssertEqual(fix.sourceName, "RoachPhone CSV")
    }

    func testPhoneLocationParserRejectsOversizedPayloadsAndBadCoordinates() {
        XCTAssertThrowsError(try RoachPhoneLocationPayloadParser.parse(String(repeating: "1", count: RoachPhoneLocationPayloadParser.maxPayloadCharacters + 1))) { error in
            XCTAssertEqual(error as? RoachPhoneLocationPayloadError, .payloadTooLarge)
        }

        XCTAssertThrowsError(try RoachPhoneLocationPayloadParser.parse("91,-86")) { error in
            XCTAssertEqual(error as? RoachPhoneLocationPayloadError, .invalidCoordinate)
        }
    }

    func testNavigationSnapshotLabelsLiveFixAndDistance() {
        let previous = RoachPhoneLocationFix(
            latitude: 39.76820,
            longitude: -86.15800,
            accuracyMeters: 10,
            speedMetersPerSecond: 9,
            courseDegrees: 90,
            altitudeMeters: nil,
            timestamp: Date(timeIntervalSince1970: 1_800_000_000),
            sourceName: "RoachPhone"
        )
        let latest = RoachPhoneLocationFix(
            latitude: 39.76862,
            longitude: -86.15823,
            accuracyMeters: 8,
            speedMetersPerSecond: 12.4,
            courseDegrees: 244,
            altitudeMeters: nil,
            timestamp: Date(timeIntervalSince1970: 1_800_000_010),
            sourceName: "RoachPhone"
        )

        let snapshot = RoachMapNavigationSnapshot(
            latestFix: latest,
            previousFix: previous,
            now: Date(timeIntervalSince1970: 1_800_000_015)
        )

        XCTAssertTrue(snapshot.isLive)
        XCTAssertEqual(snapshot.ageLabel, "5s ago")
        XCTAssertEqual(snapshot.speedLabel, "28 mph")
        XCTAssertEqual(snapshot.headingLabel, "SW 244°")
        XCTAssertEqual(snapshot.reliabilityLabel, "Good")
        XCTAssertNotEqual(snapshot.stepDistanceLabel, "0 ft")
    }

    func testNavigationSnapshotMarksStaleFix() {
        let latest = RoachPhoneLocationFix(
            latitude: 39.76862,
            longitude: -86.15823,
            accuracyMeters: 8,
            speedMetersPerSecond: nil,
            courseDegrees: nil,
            altitudeMeters: nil,
            timestamp: Date(timeIntervalSince1970: 1_800_000_000),
            sourceName: "RoachPhone"
        )

        let snapshot = RoachMapNavigationSnapshot(
            latestFix: latest,
            previousFix: nil,
            now: Date(timeIntervalSince1970: 1_800_000_090)
        )

        XCTAssertFalse(snapshot.isLive)
        XCTAssertEqual(snapshot.reliabilityLabel, "Stale")
        XCTAssertEqual(snapshot.speedLabel, "Idle")
        XCTAssertEqual(snapshot.headingLabel, "No heading")
    }

    func testOpenMapSourceProfilesKeepOfflineStackLocalFirst() {
        XCTAssertEqual(RoachOpenMapSource.defaults.map(\.id), ["osm", "openmaptiles", "osrm", "valhalla"])
        XCTAssertTrue(RoachOpenMapSource.defaults[0].detail.contains("avoids bulk scraping"))
    }
}
