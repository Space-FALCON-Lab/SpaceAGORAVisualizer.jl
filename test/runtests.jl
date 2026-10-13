using Test, SHA, JSON, Base64, SpaceAGORAVisualizer
const V = SpaceAGORAVisualizer
const ROOT = normpath(joinpath(@__DIR__, ".."))

fixture() = JSON.parsefile(joinpath(@__DIR__, "fixtures", "small_viewer.json"))

@testset "Standalone identity and versioned data contract" begin
    @test Base.PkgId(V).uuid == Base.UUID("a4677e92-0b7f-4d10-9ebd-8cde6a49f03a")
    @test !any(x -> x.name == "SpaceAGORA", keys(Base.loaded_modules))
    @test V.CONTRACT_VERSION == V.PAYLOAD_SCHEMA_VERSION == 1
    @test V.viewer_directory() == joinpath(ROOT, "viewer")
    @test V.require_version(1) === nothing
    for version in (0, 2, "1", true)
        @test_throws V.CompatibilityError V.require_version(version)
    end
    p = fixture()
    before = deepcopy(p)
    @test V.validate_payload(p) === p
    @test p == before
    legacy = deepcopy(p); delete!(legacy, "viewer_schema")
    @test V.validate_payload(legacy) === legacy
    for version in (0, 2, "1", true)
        changed = deepcopy(p); changed["viewer_schema"] = version
        @test_throws V.CompatibilityError V.render_viewer_html(changed)
        changed = deepcopy(p); changed["scene"]["schema"] = version
        @test_throws V.CompatibilityError V.render_viewer_html(changed)
    end
    for key in ("scene", "frames")
        changed = deepcopy(p); delete!(changed, key)
        @test_throws ArgumentError V.validate_payload(changed)
    end
    for (key, value) in (("count", -1), ("count", true), ("sats", 0), ("sats", 2),
            ("t_s", [0]), ("pos_km", [1]), ("pos_dtype", "f16"))
        changed = deepcopy(p); changed["frames"][key] = value
        @test_throws ArgumentError V.validate_payload(changed)
    end
    encoded = deepcopy(p)
    encoded["frames"]["t_dtype"] = "f64"
    encoded["frames"]["t_s"] = base64encode(reinterpret(UInt8, [0.0,10.0]))
    encoded["frames"]["pos_km"] = base64encode(reinterpret(UInt8, Float32[7000,0,0,6999,75,0]))
    @test V.validate_payload(encoded) === encoded
    encoded["frames"]["pos_km"] = base64encode(UInt8[1,2,3])
    @test_throws ArgumentError V.validate_payload(encoded)
end

@testset "Pinned renderer assets and preserved HTML assembly" begin
    provenance = JSON.parsefile(joinpath(ROOT, "provenance", "extraction.json"))
    immutable = filter(x -> startswith(x["path"], "viewer/src/") || startswith(x["path"], "viewer/vendor/") || x["path"] in ("viewer/template.html", "viewer/standalone.html", "viewer/dev.html"), provenance["files"])
    @test length(immutable) >= 30
    # The extraction inventory is historical. Subsequent repairs and features
    # have separate asset records, each bound back to the original inventory.
    # Every unchanged protected asset retains its extraction pin.
    repair = JSON.parsefile(joinpath(ROOT, "provenance", "standalone-repair.json"))
    @test repair["source"] == "viewer/src/standalone.js"
    original = only(filter(entry -> entry["path"] == repair["source"], immutable))
    @test repair["original_sha256"] == original["sha256"]
    @test repair["original_git_blob"] == original["git_blob"]
    @test repair["repaired_sha256"] != original["sha256"]
    feature = JSON.parsefile(joinpath(ROOT, "provenance", "mission-segments.json"))
    changes = feature["files"]
    @test Set(item["path"] for item in changes) == Set(["viewer/src/main.js", "viewer/src/ui.js", "viewer/src/timeline.js"])
    feature_hashes = Dict(item["path"] => item["sha256"] for item in changes)
    for change in changes
        previous = only(filter(entry -> entry["path"] == change["path"], immutable))
        @test change["previous_sha256"] == previous["sha256"]
        @test change["previous_git_blob"] == previous["git_blob"]
    end
    for entry in immutable
        expected = get(feature_hashes, entry["path"], entry["path"] == repair["source"] ? repair["repaired_sha256"] : entry["sha256"])
        @test bytes2hex(sha256(read(joinpath(ROOT, entry["path"])))) == expected
    end
    imports = V.viewer_import_map()["imports"]
    @test length(imports) == length(V.VIEWER_MODULES) + length(V.VIEWER_VENDOR)
    @test all(startswith(value, "data:text/javascript;base64,") for value in values(imports))
    for (specifier, path) in V.VIEWER_VENDOR
        @test String(base64decode(split(imports[specifier], ','; limit=2)[2])) == read(joinpath(V.VIEWER_DIR, path), String)
    end
    p = fixture(); p["scene"]["spacecraft"][1]["name"] = "</script><img src=x>"
    html = V.render_viewer_html(p; title="<b>&title</b>")
    @test !occursin("__PAYLOAD__", html)
    @test !occursin("__IMPORTMAP__", html)
    @test !occursin("__TITLE__", html)
    @test occursin("&lt;b&gt;&amp;title&lt;/b&gt;", html)
    @test !occursin("</script><img", html)
    embedded = match(r"window\.SPACEAGORA_VIEWER = (.*?);\n</script>"s, html)
    @test embedded !== nothing
    @test JSON.parse(embedded.captures[1]) == p
    # Validation is the only wrapper around the extracted assembly.
    @test html == V._render_viewer_html(p; title="<b>&title</b>")
    mktempdir() do dir
        @test_throws ArgumentError V.viewer_import_map(dir)
        @test_throws ArgumentError V.render_viewer_html(fixture(); viewer_dir=dir)
        write(joinpath(dir, "template.html"), "__TITLE__")
        @test_throws ArgumentError V.render_viewer_html(fixture(); viewer_dir=dir)
    end
end

@testset "File, prefix and directory workflows fail before replacing output" begin
    mktempdir() do dir
        p = fixture()
        custom = joinpath(dir, "custom_viewer.json")
        write(custom, JSON.json(p))
        expected = joinpath(dir, "custom_viewer.html")
        @test V.visualize(custom) == expected
        @test isfile(expected)
        @test V.visualize(joinpath(dir, "custom")) == expected
        @test V.visualize(dir) == expected
        second = joinpath(dir, "second_viewer.json"); write(second, JSON.json(p))
        @test_throws ArgumentError V.visualize(dir)
        default = joinpath(dir, "simulation_results_viewer.json"); write(default, JSON.json(p))
        @test V.visualize(dir) == joinpath(dir, "simulation_results_viewer.html")
        explicit = joinpath(dir, "nested", "chosen.html")
        @test V.visualize(custom; out=explicit, title="Chosen") == explicit
        @test occursin("<title>Chosen</title>", read(explicit, String))
        @test_throws ArgumentError V.visualize(custom; out=custom)
        alias = joinpath(dir, "alias.json"); symlink(custom, alias)
        @test_throws ArgumentError V.visualize(custom; out=alias)
        hard_alias = joinpath(dir, "hard-alias.json"); hardlink(custom, hard_alias)
        @test_throws ArgumentError V.visualize(custom; out=hard_alias)
        @test samefile(custom, hard_alias)
        sentinel = joinpath(dir, "keep.txt"); write(sentinel, "keep exactly")
        @test_throws ArgumentError V.visualize(custom; out=dir)
        @test isdir(dir)
        @test read(sentinel, String) == "keep exactly"
        dir_alias = joinpath(dir, "directory-alias"); symlink(dir, dir_alias)
        @test_throws ArgumentError V.visualize(custom; out=dir_alias)
        @test islink(dir_alias)
        @test read(sentinel, String) == "keep exactly"
        @test JSON.parsefile(custom) == p
        p["viewer_schema"] = 999; write(custom, JSON.json(p))
        original = read(explicit, String)
        @test_throws V.CompatibilityError V.visualize(custom; out=explicit)
        @test read(explicit, String) == original
        scene = joinpath(dir, "run_scene.json"); write(scene, JSON.json(p["scene"]))
        @test_throws ArgumentError V.visualize(scene)
        feather = joinpath(dir, "run.feather"); write(feather, "not decoded here")
        @test_throws ArgumentError V.visualize(feather)
        @test_throws ArgumentError V.visualize(joinpath(dir, "absent"))
        mktempdir() do empty
            @test_throws ArgumentError V.visualize(empty)
        end
    end
end

@testset "Actual legacy core ensemble and empty-table payloads" begin
    ensemble = JSON.parsefile(joinpath(@__DIR__, "fixtures", "legacy_ensemble_viewer.json"))
    @test !haskey(ensemble, "viewer_schema")
    @test ensemble["frames"]["count"] == 3
    @test ensemble["frames"]["sats"] == length(ensemble["scene"]["spacecraft"]) == 2
    @test ensemble["ensemble"]["spacecraft_per_sample"] == 1
    @test ensemble["ensemble"]["count"] == 2
    positions = reinterpret(Float64, base64decode(ensemble["frames"]["pos_km"]))
    @test count(isnan, positions) == 3 # delayed sample has no first-frame position
    before = deepcopy(ensemble)
    @test V.validate_payload(ensemble) === ensemble
    html = V.render_viewer_html(ensemble)
    embedded = match(r"window\.SPACEAGORA_VIEWER = (.*?);\n</script>"s, html)
    @test JSON.parse(embedded.captures[1]) == before
    @test ensemble == before
    empty = JSON.parsefile(joinpath(@__DIR__, "fixtures", "empty_viewer.json"))
    @test empty["frames"]["count"] == 0
    @test isempty(base64decode(empty["frames"]["t_s"]))
    @test isempty(base64decode(empty["frames"]["pos_km"]))
    @test V.validate_payload(empty) === empty
    @test occursin("window.SPACEAGORA_VIEWER", V.render_viewer_html(empty))
end

@testset "Optional actual mission history" begin
    p = JSON.parsefile(joinpath(@__DIR__, "fixtures", "mission_viewer.json"))
    before = deepcopy(p)
    @test V.validate_payload(p) === p
    @test p == before
    html = V.render_viewer_html(p)
    embedded = match(r"window\.SPACEAGORA_VIEWER = (.*?);\n</script>"s, html)
    @test JSON.parse(embedded.captures[1])["mission"] == p["mission"]
    @test !any(x -> x.name == "SpaceAGORA", keys(Base.loaded_modules))
    early = deepcopy(p); pop!(early["mission"]["transitions"])
    @test V.validate_payload(early) === early
    empty = deepcopy(p); empty["mission"]["segments"] = []; empty["mission"]["transitions"] = []
    @test V.validate_payload(empty) === empty
    zero = deepcopy(p)
    zero["mission"]["segments"][1]["end_s"] = 0.0
    zero["mission"]["segments"][2]["start_s"] = 0.0
    zero["mission"]["transitions"][1]["time_s"] = 0.0
    @test V.validate_payload(zero) === zero
    mutations = (
        m -> m["schema"] = true,
        m -> m["schema"] = 2,
        m -> m["name"] = " ",
        m -> m["segments"] = "coast",
        m -> m["segments"][1]["start_s"] = -1,
        m -> m["segments"][1]["end_s"] = Inf,
        m -> m["segments"][1]["end_s"] = NaN,
        m -> m["segments"][1]["end_s"] = true,
        m -> m["segments"][2]["name"] = "coast",
        m -> m["segments"][2]["start_s"] = 6,
        m -> m["segments"][2]["end_s"] = 4,
        m -> m["transitions"][1]["time_s"] = 4,
        m -> m["transitions"][1]["from"] = "unknown",
        m -> m["transitions"][1]["to"] = nothing,
        m -> m["transitions"][2]["to"] = "coast",
        m -> delete!(m["transitions"][2], "to"),
        m -> m["transitions"][2]["reason"] = " ",
        m -> empty!(m["transitions"]),
    )
    for mutate in mutations
        changed = deepcopy(p); mutate(changed["mission"])
        @test_throws ArgumentError V.validate_payload(changed)
    end
    mktempdir() do directory
        input = joinpath(directory, "run_viewer.json"); write(input, JSON.json(p))
        output = V.visualize(directory)
        original = read(output)
        p["mission"]["schema"] = 2; write(input, JSON.json(p))
        @test_throws ArgumentError V.visualize(directory)
        @test read(output) == original
    end
end

@testset "Legacy Float32 mission timestamp metadata stays exact" begin
    p = JSON.parsefile(joinpath(@__DIR__, "fixtures", "mission_precision_viewer.json"))
    @test get(p["frames"], "t_dtype", "f32") == "f32"
    @test Float64(Float32(p["frames"]["t_s"][1])) > p["mission"]["segments"][1]["start_s"]
    @test Float64(Float32(p["frames"]["t_s"][2])) < p["mission"]["transitions"][1]["time_s"]
    before = deepcopy(p)
    @test V.validate_payload(p) === p
    html = V.render_viewer_html(p)
    embedded = match(r"window\.SPACEAGORA_VIEWER = (.*?);\n</script>"s, html)
    @test JSON.parse(embedded.captures[1]) == before
    @test p == before
end
