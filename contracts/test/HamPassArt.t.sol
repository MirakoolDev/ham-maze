// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import {Test, console} from "forge-std/Test.sol";
import {HamPassArt, IFundingWorksPass} from "../src/HamPassArt.sol";

contract MockCampaign is IFundingWorksPass {
    mapping(uint256 => uint256) public left;
    function initialLockedPerToken() external pure returns (uint256) { return 0.04 ether; }
    function getRemainingLockedEth(uint256 tokenId) external view returns (uint256) { return left[tokenId]; }
    function vestingEndDate() external pure returns (uint256) { return 1_810_771_200; } // 2027-05-20
    function setLeft(uint256 id, uint256 v) external { left[id] = v; }
}

contract HamPassArtTest is Test {
    HamPassArt art;
    MockCampaign camp;

    function setUp() public {
        art = new HamPassArt();
        camp = new MockCampaign();
    }

    function test_zeroBeforeCampaignSet() public view {
        assertEq(art.streamed(1), 0);
        assertTrue(bytes(art.tokenURI(1)).length > 1000);
    }

    function test_campaignOnceOnlyByOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(HamPassArt.NotOwner.selector);
        art.setCampaign(camp);
        art.setCampaign(camp);
        vm.expectRevert(HamPassArt.CampaignAlreadySet.selector);
        art.setCampaign(camp);
    }

    function test_streamedFollowsCampaign() public {
        art.setCampaign(camp);
        camp.setLeft(1, 0.04 ether);
        camp.setLeft(2, 0.024 ether);
        camp.setLeft(3, 0);
        assertEq(art.streamed(1), 0);
        assertEq(art.streamed(2), 40);
        assertEq(art.streamed(3), 100);
    }

    function test_tokenURIGas() public {
        art.setCampaign(camp);
        uint256 g = gasleft();
        art.tokenURI(77);
        console.log("tokenURI gas", g - gasleft());
    }

    function test_printSvgs() public {
        art.setCampaign(camp);
        camp.setLeft(1, 0.04 ether);
        camp.setLeft(42, 0.024 ether);
        camp.setLeft(500, 0);
        console.log(art.svg(1));
        console.log(art.svg(42));
        console.log(art.svg(500));
    }
}
