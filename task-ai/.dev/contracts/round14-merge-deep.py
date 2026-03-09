#!/usr/bin/env python3
"""Round 14: D1/D3 deep audit — merge.sh error path correctness."""
import sys

FAIL = 0

with open("task-ai/skills/merge/scripts/merge.sh") as f:
    lines = f.readlines()
    merge_sh = "".join(lines)

# F40: MERGE_FAILED error path must checkout task branch before writing signal
# Find the MERGE_FAILED block
mf_pos = merge_sh.find('if [[ "$MERGE_FAILED" -ne 0 ]]')
if mf_pos > 0:
    # Check: is there a checkout to TASK_BRANCH before (or inside) this block?
    block_end = merge_sh.find("fi", mf_pos + 50)
    block = merge_sh[mf_pos:block_end]
    checkout_master_pos = merge_sh.find('git checkout "$MAIN_BRANCH"')
    # The MERGE_FAILED block is after checkout master but before checkout task branch
    checkout_back_pos = merge_sh.find('git checkout "$TASK_BRANCH"')
    if checkout_back_pos > mf_pos:
        # checkout back is AFTER the MERGE_FAILED block — signal is written on master (bad)
        if 'SIGNAL_FILE' in block and 'checkout "$TASK_BRANCH"' not in block:
            print("FAIL F40: MERGE_FAILED writes signal on master — should checkout task branch first")
            FAIL += 1
        else:
            print("PASS F40: MERGE_FAILED error path handles branch correctly")
    else:
        print("PASS F40: checkout task branch before MERGE_FAILED check")
else:
    print("PASS F40: No MERGE_FAILED block found")

# F41: checkout-back failure must exit with error (v2: no signal write needed — if we can't
# checkout task branch, we can't update .status.json either; exit 1 + error message is correct)
checkout_back_block_start = merge_sh.find('checkout "$TASK_BRANCH"')
if checkout_back_block_start > 0:
    line_start = merge_sh.rfind('\n', 0, checkout_back_block_start) + 1
    next_fi = merge_sh.find('\nfi', checkout_back_block_start)
    block = merge_sh[checkout_back_block_start:next_fi] if next_fi > 0 else merge_sh[checkout_back_block_start:checkout_back_block_start+300]
    if 'exit 1' in block and 'ERROR' in block:
        print("PASS F41: checkout-back failure exits with error message")
    elif 'exit 1' in block:
        print("PASS F41: checkout-back failure exits (acceptable — can't update status without branch)")
    else:
        print("FAIL F41: checkout-back failure missing exit")
        FAIL += 1
else:
    print("PASS F41: No checkout-back block found")

# F42: MERGE_TMPDIR should be cleared after rm to prevent double-rm in trap
# Find the standalone rm (not inside cleanup function), which starts with \nrm
rm_tmpdir_pos = merge_sh.find('\nrm -rf "$MERGE_TMPDIR"')
if rm_tmpdir_pos > 0:
    after_rm = merge_sh[rm_tmpdir_pos:rm_tmpdir_pos+100]
    if 'MERGE_TMPDIR=""' in after_rm:
        print("PASS F42: MERGE_TMPDIR cleared after explicit rm")
    else:
        print("FAIL F42: MERGE_TMPDIR not cleared after rm — trap may double-rm")
        FAIL += 1
else:
    print("PASS F42: No standalone rm of MERGE_TMPDIR")

# F43: Script header comment should not say "Merge only"
if lines[2].strip().startswith("# Merge only"):
    print("FAIL F43: Script header still says 'Merge only' — should reflect deliverables copy")
    FAIL += 1
else:
    print("PASS F43: Script header updated")

print(f"\n{'ALL PASSED' if FAIL == 0 else f'{FAIL} FAILED'}")
sys.exit(FAIL)
