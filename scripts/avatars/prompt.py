import hashlib, re
BASE = ("Square full-bleed painted portrait (no circle, no border, background fills the whole square). "
        "Dignified matte gouache and oil painting, head and shoulders, three-quarter view, face centred with headroom. "
        "Soft warm key light from the upper left, plain smooth gradient background of muted deep slate blue. ")
TAIL = " Calm, dignified expression. No text, no halo, no religious symbols, no modern clothing, no armour, no weapons, no necklace or jewellery at the neck."
OVERRIDE = {
 "haman-est-3-1": "the Agagite (Esther 3:1), a high official at the Persian court",
 "john-mat-3-1": "a lean prophet of the wilderness",
 "saul-1sa-9-2": "a tall, choice young king, higher than any of the people from his shoulders upward (1 Samuel 9:2)",
 "absalom-2sa-3-3": "a strikingly handsome young prince with a great, thick head of hair (2 Samuel 14:25-26)",
 "samuel-1sa-1-20": "an aged prophet in a plain linen ephod and a simple mantle",
 "eli-1sa-1-3": "a very old and heavy high priest, eyes dim (1 Samuel 4:15)",
}
AGE = {"joseph-gen-30-24": "thirty years old (Genesis 41:46)", "seth-gen-4-25": "an aged elder (Genesis 5:8)", "enosh-gen-4-26": "an aged elder (Genesis 5:11)", "kenan-gen-5-9": "an aged elder (Genesis 5:14)", "mahalalel-gen-5-12": "an aged elder (Genesis 5:17)", "jared-gen-5-15": "an aged elder (Genesis 5:20)", "enoch-gen-5-18": "an aged elder (Genesis 5:23)", "lamech-gen-5-25": "an aged elder (Genesis 5:31)", "shem-gen-5-32": "an aged elder (Genesis 11:10-11)", "abel-gen-4-2": "a young man in his twenties", "adam-gen-2-19": "an aged elder (Genesis 5:5)", "methuselah-gen-5-21": "a very aged elder, the oldest of men (Genesis 5:27)", "noah-gen-5-29": "an aged elder (Genesis 9:29)", "eve-gen-3-20": "in her forties", "esther-est-2-7": "a young woman in her twenties", "aaron-exo-4-14": "an elder in his eighties", "ruth-rut-1-4": "a young woman in her twenties", "orpah-rut-1-4": "a young woman in her twenties", "rachel-gen-29-6": "a young woman in her twenties", "leah-gen-29-16": "a young woman in her twenties", "rebekah-gen-22-23": "a young woman in her twenties", "zipporah-exo-2-21": "in her thirties", "dinah-gen-30-21": "a young woman in her twenties", "sarah-gen-11-29": "an elder woman in her sixties", "john-mat-3-1": "about thirty", "saul-1sa-9-2": "in his thirties", "absalom-2sa-3-3": "in his twenties", "samuel-1sa-1-20": "an elder in his seventies", "eli-1sa-1-3": "an elder in his nineties"}
DRESS = {"elijah-1ki-17-1": "a rough hairy garment of an hairy man, girt with a girdle of leather about his loins (2 Kings 1:8)", "joseph-gen-30-24": "draped vestures of fine white linen, ancient, not a shirt, a gold chain about his neck (Genesis 41:42)", "adam-gen-2-19": "royal garments: a rich royal robe of fine dyed linen and wool, no crown", "eve-gen-3-20": "royal garments: a rich royal robe of fine dyed linen and wool, a head covering, modest dress", "haman-est-3-1": "rich Persian court robes", "john-mat-3-1": "raiment of camel's hair with a leathern girdle (Matthew 3:4)"}
# Every nation was dark before the mingling (Genesis 2:7: man formed "of the dust of the ground"); only Esau's line
# came out "red" (Genesis 25:25). So Bible-era nations are dark-skinned, with the features their people carry today.
LOOK = {
    "moab": "a dark brown complexion, with the facial features of the people known today as the Chinese, straight black hair",
    "ammon": "a dark brown complexion, with the facial features of the people known today as the Japanese, straight black hair",
    "ishmael": "a dark brown complexion, with the facial features of the people known today as the Arabs, dark curly hair",
    "syria": "a dark brown complexion, with the facial features of the people known today as the Syrians, dark curly hair",
    "assyria": "a dark brown complexion, with the facial features of the people known today as the Kurds, dark curly hair",
    "elam": "a dark brown complexion, with the facial features of the people known today as the East Indians, straight black hair",
    "japheth": "a dark brown complexion, with the facial features of the people known today as the Polynesians and Pacific Islanders, dark curly hair",
}
# The sons of Ham by the assembly's chart (Genesis 10:6-20): Cush, Ethiopians; Mizraim, Egyptians and Watusi;
# Phut, North Africans; Canaan, South Africans.
HAM_PEOPLE = {"Cush": "the Ethiopians", "Egypt": "the Egyptians and the Watusi", "Philistia": "the Egyptians and the Watusi", "Mizraim": "the Egyptians and the Watusi",
              "Put": "the North Africans", "Canaan": "the South Africans"}
def ham_people(tribe):
    for k, v in HAM_PEOPLE.items():
        if tribe == k or tribe.startswith(k + " ") or f"({k})" in tribe or tribe.endswith(f"{k})"): return v
    return None
NATION = {"moab": "a Moabite", "ammon": "an Ammonite", "ishmael": "an Arab", "syria": "a Syrian", "assyria": "an Assyrian", "elam": "an Elamite", "japheth": "a son of Japheth"}
def pick(h, i, opts): return opts[h[i] % len(opts)]
def prompt(p):
    h = hashlib.sha1(p['id'].encode()).digest()
    d = p['desc']; dl = d.lower(); fem = p['type'] == 'Female'
    age = pick(h, 0, ["in his late twenties", "in his thirties", "in his forties", "in his fifties", "in his sixties", "an elder in his seventies"])
    if 'son living at the time of the patriarchs' in dl: age = pick(h, 0, ["in his thirties", "in his forties", "in his fifties"])
    if fem and 'daughter' in dl: age = "a young woman in her twenties"
    elif fem: age = age.replace("his", "her").replace("an elder", "an elder woman")
    feats = ", ".join([
        pick(h, 5, ["a broad flat nose", "a long straight nose", "a hooked nose", "a short wide nose", "a strong aquiline nose", "a rounded nose", "a narrow high-bridged nose"]),
        pick(h, 6, ["full lips", "thin lips", "a wide mouth", "a small mouth", "heavy full lips", "a firm set mouth"]),
        pick(h, 7, ["wide-set eyes", "narrow eyes", "large eyes", "deep hooded eyes", "almond eyes", "small keen eyes"]),
        pick(h, 8, ["heavy brows", "thin arched brows", "straight thick brows", "a furrowed brow line", "sparse brows"]),
        pick(h, 9, ["a lean build", "a stocky build", "a heavy build", "a wiry build", "a broad-shouldered build", "a slight build"]),
        pick(h, 10, ["a calm gaze", "a thoughtful look", "a resolute look", "a gentle look", "a watchful look", "a grave look"]),
    ])
    face = pick(h, 1, ["a broad face", "a long narrow face", "a square face with a strong jaw", "a round face with full cheeks", "a lean angular face", "an oval face", "a heart-shaped face with a pointed chin", "a wide face with high cheekbones"])
    age = AGE.get(p['id'], age)
    elder = "fifties" in age or "sixties" in age or "seventies" in age or "aged elder" in age
    if p['n'] == 'cainline':
        hair = pick(h, 2, ["thin straight light brown", "thin straight sandy", "thin straight pale blond", "thin straight reddish-brown"])
        skin = (f"fair skin lacking melanin (the Bishop: \"Cain's line was cursed with a lack of melanin\"), {hair} hair"
                + ("" if fem else ", " + pick(h, 3, ["a short beard", "a trimmed beard", "a full beard"])) + ", distinct features, dignified, not villainous")
    elif p['n'] in LOOK:
        beard = "" if fem else ", " + pick(h, 3, ["a full beard", "a short beard", "a trimmed beard"] if p['n'] not in ("moab", "ammon", "japheth") else ["a short beard", "clean-shaven", "a thin moustache and short beard"])
        skin = LOOK[p['n']] + beard
    elif p['n'] == 'edom':
        hair = pick(h, 2, ["thin straight auburn", "thin straight light brown", "thin straight sandy", "thin straight reddish-brown", "thin straight greying brown"])
        skin = f"fair skin with a natural ruddy flush (Edom, as Genesis 25:25 describes Esau), {hair} hair" + ("" if fem else ", " + pick(h, 3, ["a short beard", "clean-shaven", "a trimmed beard"])) + ", distinct features, dignified, not villainous"
    else:
        tone = pick(h, 2, ["a deep black complexion", "a dark brown complexion", "a very dark complexion", "a rich dark brown complexion", "a deep brown complexion"])
        hair = "short, tight, kinky woolly " + ("grey-and-white" if elder and (h[4] % 2 or "aged elder" in age) else "black") + " coils close to the head, not locs, not loose curls, not waves"
        if p['n'] == 'ham' and dl.startswith('pharaoh') and not fem:
            # The assembly's direction: Pharaoh shaven bald, with Egyptian eyeliner (the Egyptian court shaved: Genesis 41:14)
            hair = "a clean-shaven bald head, dark Egyptian eyeliner (kohl) around the eyes"
        beard = "" if fem else ", clean-shaven" if dl.startswith('pharaoh') or p['id'] == 'joseph-gen-30-24' else ", " + pick(h, 3, ["a full beard with its natural line", "a short full beard with its natural line", "a long beard with its natural line"])
        if not fem and not (p['n'] == 'ham' and dl.startswith('pharaoh')):
            hair += ", a full head of hair, not bald, no receding hairline"   # "no bald heads" (Leviticus 21:5)
        if p['id'] == 'samson-jdg-13-24':
            # a Nazarite: "no razor shall come on his head" (Judges 13:5); "the seven locks of his head" (Judges 16:13, 19)
            hair = "his never-cut hair in seven long locks (Judges 13:5; 16:13, 19), a full head of hair"
        if p['id'] == 'elisha-1ki-19-16':
            hair = "a bald head (2 Kings 2:23)"
        if p['id'] == 'adam-gen-2-19':
            # Adam was made in the image of Christ, whose "head and his hairs were white like wool" (Revelation 1:14)
            hair = "in the likeness of Christ: a full thick head of white woolly hair and a full white woolly beard (Revelation 1:14), not bald, no receding hairline"
            beard = ""
        skin = f"{tone}, {hair}{beard}"
        if p['id'] == 'cain-gen-4-1':
            # The mark set upon Cain (Genesis 4:15) was leprosy, as the assembly teaches; leprosy is "white as snow" (Numbers 12:10)
            # The assembly's direction: Cain fully leprous, his melanin gone, "blue eyes, blondie" (Genesis 4:15; Leviticus 13:13)
            skin = ("fully leprous, his melanin gone: his whole skin turned white as snow (Genesis 4:15; Leviticus 13:13), "
                    "blue eyes, thin straight blond hair and a blond beard; shown with dignity, not grotesque, no sores")
    tribe = p['tribe'].replace('(?)', '').replace('>', '').strip()
    if p['n'] == 'cainline': who = ("a woman" if fem else "a man") + " of the line of Cain, before the Flood"
    elif p['n'] == 'adam': who = ("a woman" if fem else "a man") + " of the generations of Adam (Genesis 5:1), before the Flood"
    elif p['n'] == 'hebrew': who = "a Hebrew " + ("woman" if fem else "man") + " of the house of Terah, kin of Abraham"
    elif p['n'] == 'japheth': who = "a " + ("woman" if fem else "man") + " of the sons of Japheth"
    elif p['n'] in LOOK: who = NATION[p['n']] + (" woman" if fem else " man") + (" of the sons of Keturah" if 'Keturah' in tribe else "")
    else: who = {"israel": "an Israelite " + ("woman" if fem else "man") + (" of " + ("the " if tribe.startswith('Tribe') else "") + tribe),
           "ham": ("a Hamite " + ("woman" if fem else "man") + f" of {tribe}" + (f", of the people known today as {ham_people(tribe)}" if ham_people(tribe) else "")), "edom": ("an Edomite " + ("woman" if fem else "man") + (" in Roman office" if p['tribe'] == 'Italy' else ""))}[p['n']]
    # dress
    pre_sinai = 'patriarchs' in dl and 'wilderness' not in dl
    if p['n'] in ('hebrew', 'adam', 'cainline'): pre_sinai = True
    # Headwear by office, as the KJV gives it: kings a crown (2 Samuel 1:10; 12:30; Psalm 21:3); the high priest
    # the mitre with the golden plate (Exodus 28:36-39); priests linen bonnets (Exodus 28:40); every other man
    # bare-headed (1 Corinthians 11:4); women covered (1 Corinthians 11:5-6).
    # Every one the KJV calls king or queen: the Herods (Matthew 2:1; Mark 6:14; Acts 12:1; 25:13), Caesar (John 19:15), Esther (Esther 2:17)
    royal = ((re.search(r'\b(king|queen|emperor)\b', dl) is not None and not dl.startswith('pharaoh'))
             or p['id'] in ('herod-mat-2-1', 'herod-mat-14-1', 'herod-act-12-1', 'agrippa-act-25-13', 'esther-est-2-7'))
    high = 'high priest' in dl
    priest = re.search(r'\bpriest\b', dl) is not None and not high and 'Levi' in p['tribe']
    if p['n'] == 'ham' and dl.startswith('pharaoh') and not fem: dress = "a draped robe of fine white linen, vestures of fine linen (Genesis 41:42), ancient, not a shirt, no Egyptian headdress, no beaded collar"
    elif p['n'] == 'ham' and 'pharaoh' in dl: dress = "fine linen, modest dress, no beaded collar"
    elif p['n'] == 'ham': dress = "plain ancient Near Eastern wool and linen in earth tones" + (", modest dress" if fem else "")
    elif p['n'] in LOOK: dress = "plain ancient Near Eastern wool and linen in earth tones" + (", a head covering, modest dress" if fem else "")
    elif p['n'] == 'edom': dress = "royal apparel (Acts 12:21)" if royal else ("plain cream wool garments" if p['tribe'] == 'Italy' else "plain wool dress in earth tones, modest dress" if fem else "a rough tan wool garment")
    else:
        dress = "plain undyed wool and linen in earth tones"
        if high: dress = ("the holy garments of the high priest: the robe of the ephod all of blue (Exodus 28:31) and the breastplate of judgment "
                          "of gold, blue, purple, scarlet and fine twined linen set with precious stones (Exodus 28:15-17)")
        elif priest: dress = "white linen garments, the coat and girdle of the priests (Exodus 28:40)"
        elif royal: dress = "a richer dyed robe"
        elif 'singer' in dl: dress = "white linen (2 Chronicles 5:12)"
        elif 'prophet' in dl: dress = "a rough wool mantle over plain linen"
        if fem: dress += ", a cloth head covering over the whole head with no hair showing on top (1 Corinthians 11:5-6), not a headband, modest dress"
        elif not pre_sinai: dress += ", fringes on the borders of the garment held by a ribband of blue (Numbers 15:38)"
        else: dress += ", no fringes"
    if high and p['n'] in ('israel', 'hebrew'): head = "on his head the mitre of fine linen (Exodus 28:39), a wound white linen headdress, not a pointed bishop's mitre, with a small plate of pure gold tied by a blue lace upon its forefront (Exodus 28:36-37), any engraving too small to read"
    elif priest: head = "on his head a bonnet of fine linen (Exodus 28:40)"
    elif royal and fem: head = "her hair fully covered by a cloth head covering (1 Corinthians 11:5-6), and on top of the covering the royal crown (Esther 2:17), a true crown of gold with raised points, set with precious stones; no hair showing"
    elif royal: head = "on his head a crown of gold set with precious stones (2 Samuel 12:30): a true crown with raised points all around, not a band, not a circlet, not a diadem" + (", not an Egyptian headdress" if p['n'] == 'ham' else "")
    elif dl.startswith('pharaoh') and not fem: head = "shaven bald head, uncovered: no crown, no headdress, no headband, no wig"
    elif fem: head = "no crown, no headband"
    else: head = "bare head (1 Corinthians 11:4): no crown, no headband, no hat, no turban"
    dress = DRESS.get(p['id'], dress) + "; " + head
    role = OVERRIDE.get(p['id'], re.sub(r"\s+(descended\s+)?from$", "", re.sub(r"\s+", " ", d.replace("Monarchyand", "Monarchy and")).rstrip(".")))
    if p['n'] != 'edom': role = re.sub(r'\bEdomite\b', 'Woman' if fem else 'Man', role)
    tail = TAIL.replace(", no necklace or jewellery at the neck", "") if "gold chain" in dress else TAIL
    return BASE + f"Subject: {p['name']}, {who}, {role}; {age}, {face}, {feats}, {skin}. Dress: {dress}." + tail
