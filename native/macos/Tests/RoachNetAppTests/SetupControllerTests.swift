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
}
