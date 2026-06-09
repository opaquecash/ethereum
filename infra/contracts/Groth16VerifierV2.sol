// SPDX-License-Identifier: GPL-3.0
/*
    Groth16 verifier for the Opaque Cash V2 stealth-reputation circuit
    (`circuits/v2/stealth_reputation.circom`, 4 public signals).

    This follows the snarkjs verifier template (Copyright 2021 0KIMS association,
    GPL-3.0). The verification-key constants below are transcribed from the V2
    circuit's `verification_key.json` — the SAME key the Solana on-chain verifier
    uses — so a V2 proof verifies identically on Ethereum and Solana.

    Public signals (snarkjs order = circuit public-input declaration order):
      [0] merkle_root
      [1] attestation_id    (= schema_id)
      [2] external_nullifier
      [3] nullifier_hash
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16VerifierV2 {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data (from circuits/v2 verification_key.json)
    uint256 constant alphax  = 411686407637245237335477931285786328323282532991334681491001618979380270359;
    uint256 constant alphay  = 21542919954699962543480001675642673464578840556317525212081323168504332775260;
    uint256 constant betax1  = 18107330339635996815429327094908135345454378253301432438941576225086314106442;
    uint256 constant betax2  = 14604021075335953742610804278531986782460569750797739909953413543112537128228;
    uint256 constant betay1  = 21353501526324058080431801971145857555871903173665097809130141788291421354264;
    uint256 constant betay2  = 17533496805068883764029418947356143307002889328593296176582378223077671427841;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 18081989589102997950907576228463519933454551845181119081403434055431809041500;
    uint256 constant deltax2 = 3229822502330838413457437113381159089119434100481266422708791223173395067111;
    uint256 constant deltay1 = 7055784544143757404311121393331421291232096236017800421290655894559736739241;
    uint256 constant deltay2 = 17644637792660480471380226808490427712781285743524285624397848174902164158157;


    uint256 constant IC0x = 16655737118396325797683856344191979299781145509105339761021199758594471310862;
    uint256 constant IC0y = 15775001973251176051459765844443626307979980902827419616623313053527988752908;

    uint256 constant IC1x = 11137835127946356696578396508625202151599188726761758812432249619581315802548;
    uint256 constant IC1y = 13003582409547890341871311369852289364917564911579819192273828990605424925150;

    uint256 constant IC2x = 21173950767373603400724559296913566537977880363895238334438459445768225020504;
    uint256 constant IC2y = 752565860759711892137546913220770897884306028037682959422765879581287628249;

    uint256 constant IC3x = 3756426592689468037571893558593382628842743659954704078427098662778964016105;
    uint256 constant IC3y = 16048924896312129023972408226185389810044209593286027533925400114769166064548;

    uint256 constant IC4x = 1383514090708773036043396280494325071069324923278303147297280099414793502943;
    uint256 constant IC4y = 19105605520867490084627253726230007381179538334615496896387907749819267342618;


    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[4] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x

                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))

                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))

                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))

                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))


                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F

            checkField(calldataload(add(_pubSignals, 0)))

            checkField(calldataload(add(_pubSignals, 32)))

            checkField(calldataload(add(_pubSignals, 64)))

            checkField(calldataload(add(_pubSignals, 96)))


            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
            return(0, 0x20)
        }
    }
}
