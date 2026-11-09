# Icon cut-out tools (offline, not part of the running app)

How the 20 pictures in `../../user/icons/` were made from the owner's `SMART_AI_35_Individual_Icons.zip` (35 PNGs, 512 x 512, each with a light-blue
halo and a faint leftover rectangle baked in; the owner: "extract them perfectly, get the best ones, not all").

    pip install numpy scipy pillow opencv-python-headless pymatting
    python3 survey.py  <pack folder>                               # the shared page picture (mode_rgb.npy, not committed)
    python3 cutout.py  <pack folder> <cut folder> A_home B_deposit ...   # transparent 512 px cut-outs (hints.json = hand outlines)
    python3 finalize.py <cut folder> <out folder> 192 navhome=A_home recharge=B_deposit ...   # crop, centre in a square, 192 px WebP

Method (`cutout.py`): the page = everything reachable from the picture border without crossing an edge (flood on a smoothed Lab gradient), the icon = what the
flood cannot reach (white bodies enclosed by an outline stay), then thin slivers are opened away, narrow slits closed, the outline smoothed, and closed-form
matting (pymatting) gives alpha and decontaminated edge colours in a 2 px band. `hints.json` holds hand-made outlines for the icons whose pale rim has
no edge to find (`B_trade_password`: the whole shield). Checked on white, light blue, the brand blue and navy before shipping.

Chosen (and why the rest was left out): the five tabs, the four Home buttons, the two floating pictures and the nine My page rows (20 files). Not used:
`A_settings`/`B_settings` (no Settings page), `A_balance`, `A_deposit`/`A_withdraw` (white tray tops merge with the page; `B_deposit`/`B_withdraw` cut cleanly),
`A_log_out` (Log Out is a button), `B_my_team`/`B_about_us`/`B_bank_card`/`B_balance_detail`/`B_gift_code`' duplicates, and the five `Nav_*` pictures
(their labels are baked into the picture).
