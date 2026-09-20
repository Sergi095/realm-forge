"""Build an append-only material catalog from official Java client metadata.
Downloads/reads ZIP data only; never executes the game or copies game textures.
Usage: python3 scripts/update-material-catalog.py [version] (default: latest release)
"""
import hashlib,io,json,pathlib,re,sys,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
def fetch(url):
    return urllib.request.urlopen(url,timeout=60).read()
manifest=json.loads(fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'))
version=sys.argv[1] if len(sys.argv)>1 else manifest['latest']['release']
info=next(v for v in manifest['versions'] if v['id']==version)
metadata=json.loads(fetch(info['url']));client=metadata['downloads']['client']
cache=pathlib.Path('/tmp/dnd-minecraft-client.jar')
raw=cache.read_bytes() if cache.exists() and hashlib.sha1(cache.read_bytes()).hexdigest()==client['sha1'] else fetch(client['url'])
assert hashlib.sha1(raw).hexdigest()==client['sha1']
z=zipfile.ZipFile(io.BytesIO(raw));lang=json.loads(z.read('assets/minecraft/lang/en_us.json'))
keys=sorted(n.rsplit('/',1)[1][:-5] for n in z.namelist() if n.startswith('assets/minecraft/blockstates/') and n.endswith('.json'))
COLORS={'white':'#e7e7dc','orange':'#d97c2b','magenta':'#b84fac','light_blue':'#64b9d1','yellow':'#e2bf38','lime':'#81bb31','pink':'#df8dac','gray':'#51565b','light_gray':'#aaa9a0','cyan':'#228c98','purple':'#7846aa','blue':'#374aa0','brown':'#76503a','green':'#526e33','red':'#ac3834','black':'#282c32'}
WOODS={'pale_oak':'#d2cdbb','dark_oak':'#503726','oak':'#b49259','spruce':'#785733','birch':'#d7c789','jungle':'#ac805d','acacia':'#ad603d','mangrove':'#813d38','cherry':'#dca7aa','bamboo':'#b4ac50','crimson':'#733a55','warped':'#328c85'}
def appearance(key):
    words=key.split('_');category='Decorations';color='#8b8e85';texture='stone';accent='#dfdfd2'
    if any(w in key for w in ['stone','brick','tuff','quartz','granite','diorite','andesite','deepslate','calcite','basalt','prismarine']):
        category='Stone & masonry';texture='brick' if any(w in words for w in ['bricks','brick','tiles']) else 'stone'
        for k,c in {'quartz':'#dfdfd2','granite':'#a97665','diorite':'#bdbdb7','deepslate':'#484b50','tuff':'#727a69','calcite':'#dedbcc','basalt':'#51545c','prismarine':'#5b9d8c','sandstone':'#dbc388','blackstone':'#3c3741'}.items():
            if k in key:color=c
    if any(w in words for w in ['dirt','mud','sand','gravel','clay','grass','mycelium','podzol','farmland','snow','bedrock','path']):
        category='Earth & terrain';texture='grain';color='#876c4c'
        for k,c in {'sand':'#d8c58c','red_sand':'#c0753f','mud':'#635447','clay':'#a2a9b6','snow':'#e9efee','grass':'#6d9c43','mycelium':'#897887','bedrock':'#45454a','gravel':'#96908a'}.items():
            if k in key:color=c
    for k,c in WOODS.items():
        if key.startswith(k+'_') or key.startswith('stripped_'+k+'_'):
            category='Wood';texture='wood';color=c;break
    if any(w in words for w in ['copper','iron','gold','netherite','diamond','emerald','lapis','coal','amethyst','resin']):
        category='Ores & metals';texture='metal'
        for k,c in {'copper':'#ba7956','iron':'#b8b8b2','gold':'#e3be46','netherite':'#51464a','diamond':'#54c6bf','emerald':'#35ab66','lapis':'#3156a4','coal':'#33363b','amethyst':'#a685c5','resin':'#d67c30'}.items():
            if k in key:color=c
        if 'weathered' in key:color='#65a18b'
        if 'oxidized' in key:color='#4eaa8c'
        if 'exposed' in key:color='#aa8d65'
        if 'ore' in words:accent=color;color='#53565b' if 'deepslate' in key else '#888a85';texture='ore'
    if any(w in words for w in ['wool','concrete','terracotta','carpet','bed','banner','candle','shulker']):
        category='Colored blocks';texture='fabric' if any(w in words for w in ['wool','carpet','bed','banner']) else 'grain'
    if any(w in words for w in ['glass','ice']):category='Glass & ice';color='#9bcbd4';texture='glass'
    for k in sorted(COLORS,key=len,reverse=True):
        if key.startswith(k+'_') or key.startswith('potted_'+k+'_'):color=COLORS[k];break
    if any(w in words for w in ['leaves','sapling','flower','tulip','orchid','allium','poppy','dandelion','mushroom','fern','vine','vines','cactus','azalea','bush','petals','lily','wheat','carrots','potatoes','beetroots','stem','root','roots','moss','pumpkin','melon','hay']):
        category='Nature & plants';texture='grass';color='#5c8948'
        if any(w in words for w in ['flower','tulip','orchid','allium','poppy','dandelion','petals','mushroom']):texture='flower';accent=COLORS.get(words[0],'#d8a5bc')
        if 'cherry' in key:color='#e5abc5'
        if 'pumpkin' in key:color='#cf8839'
        if 'hay' in key:color='#bda847'
    if any(w in words for w in ['coral','kelp','seagrass','sponge','water','sea']):category='Ocean';color='#4d91b5';texture='water' if 'water' in key else 'grass'
    if any(w in words for w in ['netherrack','nether','soul','magma','lava','wart','nylium','shroomlight','weeping','twisting']):
        category='Nether';color='#773f40'
        if 'soul' in key:color='#625047'
        if 'magma' in key or 'lava' in key:color='#e0702e';texture='lava'
    if any(w in words for w in ['end','purpur','chorus','dragon']):category='End';color='#d7d9a6' if 'stone' in key else '#a476a1'
    if any(w in words for w in ['torch','lantern','glowstone','shroomlight','froglight','fire','campfire','jack']):category='Lighting';color='#e5c470';texture='lava'
    if any(w in words for w in ['redstone','piston','observer','dispenser','dropper','hopper','repeater','comparator','lever','button','pressure','rail','tnt','furnace','crafter','target','sensor','daylight','tripwire','sculk']):
        category='Redstone & utility';texture='machine';accent='#b44435'
    if any(w in words for w in ['chest','barrel','bookshelf','shelf','table','loom','lectern','composter','note','jukebox','beehive','bee']):category='Decorations';color='#ab804b';texture='wood'
    if 'bookshelf' in key or 'shelf' in key:texture='books'
    if key in ['air','cave_air','void_air','barrier','light','structure_void','structure_block','jigsaw','moving_piston'] or 'command_block' in key or 'test_block' in key or 'test_instance' in key:category='Technical';texture='machine';color='#a380ac'
    if key=='redstone_block':color='#b42e2a';texture='grain'
    if 'obsidian' in key:category='End';color='#30273f';texture='stone'
    if key=='bricks':color='#ac6552';texture='brick';category='Stone & masonry'
    return category,color,texture,accent
path=ROOT/'web/minecraft-catalog.json'
old=json.loads(path.read_text())['blocks'] if path.exists() else []
existing={b['key'] for b in old}
# IDs are append-only, preserving saved worlds when a later release adds blocks.
blocks=[{'key':k,'name':lang.get('block.minecraft.'+k,lang.get('item.minecraft.'+k,k.replace('_',' ').title())), 'category':appearance(k)[0],'color':appearance(k)[1],'texture':appearance(k)[2],'accent':appearance(k)[3]} for k in [b['key'] for b in old]+[k for k in keys if k not in existing]]
result={'version':version,'source':info['url'],'client_sha1':client['sha1'],'current_keys':keys,'blocks':blocks}
path.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n')
(ROOT/'src/material_catalog.rs').write_text(f'// Generated by scripts/update-material-catalog.py. IDs 0..24 preserve original worlds.\npub const MATERIAL_COUNT: u16 = {24+len(blocks)};\npub const BASE_COLOR: u16 = 12 + MATERIAL_COUNT;\n')
print(f'{version}: {len(keys)} current block states, {len(blocks)} catalog entries, {24+len(blocks)} total materials')
