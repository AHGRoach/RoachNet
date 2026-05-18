import XCTest
@testable import RoachNetSetup

final class SetupControllerTests: XCTestCase {
    func testDraftStateOverridesStayEnabledBeforeInstallStarts() {
        XCTAssertTrue(
            SetupController.shouldApplyDraftStateOverrides(
                startedInstallInCurrentSession: false,
                activeTaskStatus: nil
            )
        )

        XCTAssertTrue(
            SetupController.shouldApplyDraftStateOverrides(
                startedInstallInCurrentSession: false,
                activeTaskStatus: "completed"
            )
        )
    }

    func testDraftStateOverridesTurnOffOnceInstallStartsOrRuns() {
        XCTAssertFalse(
            SetupController.shouldApplyDraftStateOverrides(
                startedInstallInCurrentSession: true,
                activeTaskStatus: nil
            )
        )

        XCTAssertFalse(
            SetupController.shouldApplyDraftStateOverrides(
                startedInstallInCurrentSession: false,
                activeTaskStatus: "running"
            )
        )
    }

    func testSetupTaskDateParserAcceptsFractionalCompletionDates() {
        XCTAssertNotNil(SetupController.parseSetupTaskDate("2026-05-16T21:44:22.495Z"))
        XCTAssertNotNil(SetupController.parseSetupTaskDate("2026-05-16T21:44:22Z"))
        XCTAssertNil(SetupController.parseSetupTaskDate("not-a-date"))
    }
}
