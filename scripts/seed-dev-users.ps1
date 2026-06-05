$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

$composeFile = "src/docker-compose.yml"
$keycloakContainer = "wims-keycloak"
$kcServer = "http://localhost:8080/auth"
$kcRealm = "bfp"
$kcAdminUser = "admin"
$kcAdminPass = "admin"
$password = "Password123!"

$roles = @("REGIONAL_ENCODER", "NATIONAL_VALIDATOR", "ANALYST", "NATIONAL_ANALYST", "SYSTEM_ADMIN")
$users = @(
    @{ username = "encoder_ncr";   email = "encoder_ncr@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 1;     uuid = "11111111-1111-4111-8111-111111111111"; legacy = "encoder_test" },
    @{ username = "encoder_car";   email = "encoder_car@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 2;     uuid = "ee000002-0000-4002-8002-000000000002"; legacy = "encoder_r02" },
    @{ username = "encoder_r01";   email = "encoder_r01@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 3;     uuid = "ee000003-0000-4003-8003-000000000003"; legacy = "encoder_r03" },
    @{ username = "encoder_r02";   email = "encoder_r02@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 4;     uuid = "ee000004-0000-4004-8004-000000000004"; legacy = "encoder_r04" },
    @{ username = "encoder_r03";   email = "encoder_r03@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 5;     uuid = "ee000005-0000-4005-8005-000000000005"; legacy = "encoder_r05" },
    @{ username = "encoder_r04a";  email = "encoder_r04a@bfp.gov.ph";  role = "REGIONAL_ENCODER";   region = 6;     uuid = "ee000006-0000-4006-8006-000000000006"; legacy = "encoder_r06" },
    @{ username = "encoder_r04b";  email = "encoder_r04b@bfp.gov.ph";  role = "REGIONAL_ENCODER";   region = 7;     uuid = "ee000007-0000-4007-8007-000000000007"; legacy = "encoder_r07" },
    @{ username = "encoder_r05";   email = "encoder_r05@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 8;     uuid = "ee000008-0000-4008-8008-000000000008"; legacy = "encoder_r08" },
    @{ username = "encoder_r06";   email = "encoder_r06@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 9;     uuid = "ee000009-0000-4009-8009-000000000009"; legacy = "encoder_r09" },
    @{ username = "encoder_r07";   email = "encoder_r07@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 10;    uuid = "ee000010-0000-4010-8010-000000000010"; legacy = "encoder_r10" },
    @{ username = "encoder_r08";   email = "encoder_r08@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 11;    uuid = "ee000011-0000-4011-8011-000000000011"; legacy = "encoder_r11" },
    @{ username = "encoder_r09";   email = "encoder_r09@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 12;    uuid = "ee000012-0000-4012-8012-000000000012"; legacy = "encoder_r12" },
    @{ username = "encoder_r10";   email = "encoder_r10@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 13;    uuid = "ee000013-0000-4013-8013-000000000013"; legacy = "encoder_r13" },
    @{ username = "encoder_r11";   email = "encoder_r11@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 14;    uuid = "ee000014-0000-4014-8014-000000000014"; legacy = "encoder_r14" },
    @{ username = "encoder_r12";   email = "encoder_r12@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 15;    uuid = "ee000015-0000-4015-8015-000000000015"; legacy = "encoder_r15" },
    @{ username = "encoder_r13";   email = "encoder_r13@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 16;    uuid = "ee000016-0000-4016-8016-000000000016"; legacy = "encoder_r16" },
    @{ username = "encoder_barmm"; email = "encoder_barmm@bfp.gov.ph"; role = "REGIONAL_ENCODER";   region = 17;    uuid = "ee000017-0000-4017-8017-000000000017"; legacy = "encoder_r17" },
    @{ username = "encoder_nir";   email = "encoder_nir@bfp.gov.ph";   role = "REGIONAL_ENCODER";   region = 18;    uuid = "ee000018-0000-4018-8018-000000000018"; legacy = "encoder_r18" },
    @{ username = "validator_test"; email = "validator@bfp.gov.ph";    role = "NATIONAL_VALIDATOR"; region = 1;     uuid = "22222222-2222-4222-8222-222222222222"; legacy = $null },
    @{ username = "analyst_test";  email = "analyst@bfp.gov.ph";       role = "NATIONAL_ANALYST";   region = $null; uuid = "33333333-3333-4333-8333-333333333333"; legacy = $null },
    @{ username = "analyst1_test"; email = "analyst1_test@gmail.com";  role = "NATIONAL_ANALYST";   region = $null; uuid = "44444444-4444-4444-8444-444444444444"; legacy = $null },
    @{ username = "admin_test";    email = "admin@bfp.gov.ph";         role = "SYSTEM_ADMIN";       region = $null; uuid = "55555555-5555-4555-8555-555555555555"; legacy = $null }
    # Team member dev accounts (password: WimsBFP2026!)
    @{ username = "n-val"; email = "n-val@bfp.gov.ph"; role = "NATIONAL_VALIDATOR"; region = 1;     uuid = "aa000001-0000-4001-8001-aab000000001"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "n-enc"; email = "n-enc@bfp.gov.ph"; role = "REGIONAL_ENCODER";   region = 1;     uuid = "aa000002-0000-4002-8002-aab000000002"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "n-ana"; email = "n-ana@bfp.gov.ph"; role = "NATIONAL_ANALYST";   region = $null; uuid = "aa000003-0000-4003-8003-aab000000003"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "n-adm"; email = "n-adm@bfp.gov.ph"; role = "SYSTEM_ADMIN";       region = $null; uuid = "aa000004-0000-4004-8004-aab000000004"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "g-val"; email = "g-val@bfp.gov.ph"; role = "NATIONAL_VALIDATOR"; region = 1;     uuid = "bb000001-0000-4001-8001-bbb000000001"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "g-enc"; email = "g-enc@bfp.gov.ph"; role = "REGIONAL_ENCODER";   region = 1;     uuid = "bb000002-0000-4002-8002-bbb000000002"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "g-ana"; email = "g-ana@bfp.gov.ph"; role = "NATIONAL_ANALYST";   region = $null; uuid = "bb000003-0000-4003-8003-bbb000000003"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "g-adm"; email = "g-adm@bfp.gov.ph"; role = "SYSTEM_ADMIN";       region = $null; uuid = "bb000004-0000-4004-8004-bbb000000004"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "e-val"; email = "e-val@bfp.gov.ph"; role = "NATIONAL_VALIDATOR"; region = 1;     uuid = "cc000001-0000-4001-8001-ccb000000001"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "e-enc"; email = "e-enc@bfp.gov.ph"; role = "REGIONAL_ENCODER";   region = 1;     uuid = "cc000002-0000-4002-8002-ccb000000002"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "e-ana"; email = "e-ana@bfp.gov.ph"; role = "NATIONAL_ANALYST";   region = $null; uuid = "cc000003-0000-4003-8003-ccb000000003"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "e-adm"; email = "e-adm@bfp.gov.ph"; role = "SYSTEM_ADMIN";       region = $null; uuid = "cc000004-0000-4004-8004-ccb000000004"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "r-val"; email = "r-val@bfp.gov.ph"; role = "NATIONAL_VALIDATOR"; region = 1;     uuid = "dd000001-0000-4001-8001-ddb000000001"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "r-enc"; email = "r-enc@bfp.gov.ph"; role = "REGIONAL_ENCODER";   region = 1;     uuid = "dd000002-0000-4002-8002-ddb000000002"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "r-ana"; email = "r-ana@bfp.gov.ph"; role = "NATIONAL_ANALYST";   region = $null; uuid = "dd000003-0000-4003-8003-ddb000000003"; legacy = $null; password = "WimsBFP2026!" }
    @{ username = "r-adm"; email = "r-adm@bfp.gov.ph"; role = "SYSTEM_ADMIN";       region = $null; uuid = "dd000004-0000-4004-8004-ddb000000004"; legacy = $null; password = "WimsBFP2026!" }
)

Write-Host "Waiting for keycloak..."
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
    $status = docker inspect --format='{{.State.Health.Status}}' $keycloakContainer 2>$null
    if ($status -eq 'healthy') { break }
    Start-Sleep -Seconds 2
}

Write-Host "Authenticating Keycloak admin..."
docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh config credentials --server $kcServer --realm master --user $kcAdminUser --password $kcAdminPass | Out-Null

Write-Host "Ensuring roles..."
foreach ($role in $roles) {
    try {
        docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh create roles -r $kcRealm -s "name=$role" 2>$null | Out-Null
    } catch {
        # role probably already exists
    }
}

Write-Host "Allowing dev username repairs in Keycloak..."
docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh update "realms/$kcRealm" -s "editUsernameAllowed=true" | Out-Null

Write-Host "Enforcing User Profile: firstName and lastName required for non-seed users..."
docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh update "authentication/required-actions/UPDATE_PROFILE" -r $kcRealm -s "defaultAction=true" 2>$null | Out-Null
$upJson = '{"attributes":[{"name":"username","displayName":"${username}","validations":{"length":{"min":3,"max":255},"username-prohibited-characters":{},"up-username-not-idn-homograph":{}},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"email","displayName":"${email}","validations":{"email":{},"length":{"max":255}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"firstName","displayName":"${firstName}","validations":{"length":{"max":255},"person-name-prohibited-characters":{}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false},{"name":"lastName","displayName":"${lastName}","validations":{"length":{"max":255},"person-name-prohibited-characters":{}},"required":{"roles":["user"]},"permissions":{"view":["admin","user"],"edit":["admin","user"]},"multivalued":false}],"groups":[]}'
$upJson | docker exec -i $keycloakContainer bash -c 'cat > /tmp/wims-up.json && /opt/keycloak/bin/kcadm.sh update users/profile -r bfp -f /tmp/wims-up.json' 2>$null | Out-Null

foreach ($u in $users) {
    $username = $u.username
    $email = $u.email
    $role = $u.role
    $region = $u.region
    $deterministicUuid = $u.uuid
    $legacyUsername = $u.legacy
    $userPassword = if ($u.ContainsKey("password") -and $u.password) { $u.password } else { $password }
    $nameParts = $username.Split("_", 2)
    $firstName = $nameParts[0]
    $lastName = if ($nameParts.Count -gt 1) { $nameParts[1] } else { "dev" }

    Write-Host "Seeding $username ($role)..."

    $usersJson = docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh get users -r $kcRealm -q "username=$username"
    $match = [regex]::Match($usersJson, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
    $uuid = if ($match.Success) { $match.Value } else { $null }

    if (-not $uuid -and $legacyUsername) {
        $legacyJson = docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh get users -r $kcRealm -q "username=$legacyUsername"
        $legacyMatch = [regex]::Match($legacyJson, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
        if ($legacyMatch.Success) {
            $uuid = $legacyMatch.Value
            Write-Host "  Renaming legacy user $legacyUsername -> $username"
            docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh update "users/$uuid" -r $kcRealm -s "username=$username" -s "enabled=true" -s "email=$email" -s "emailVerified=true" -s "firstName=$firstName" -s "lastName=$lastName" | Out-Null
        }
    }

    if (-not $uuid) {
        try {
            docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh create users -r $kcRealm -s "id=$deterministicUuid" -s "username=$username" -s "enabled=true" -s "email=$email" -s "emailVerified=true" -s "firstName=$firstName" -s "lastName=$lastName" 2>$null | Out-Null
        } catch {
            # user may already exist
        }
        $usersJson = docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh get users -r $kcRealm -q "username=$username"
        $match = [regex]::Match($usersJson, '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
        $uuid = if ($match.Success) { $match.Value } else { $null }
    }

    if ($uuid) {
        docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh update "users/$uuid" -r $kcRealm -s "enabled=true" -s "email=$email" -s "emailVerified=true" -s "firstName=$firstName" -s "lastName=$lastName" -s "requiredActions=[]" | Out-Null
    }

    docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh set-password -r $kcRealm --username $username --new-password $userPassword | Out-Null

    try {
        docker exec $keycloakContainer /opt/keycloak/bin/kcadm.sh add-roles -r $kcRealm --uusername $username --rolename $role 2>$null | Out-Null
    } catch {
        # role likely already mapped
    }

    if (-not $uuid) {
        throw "Failed to resolve Keycloak UUID for $username"
    }

    $regionSql = if ($null -ne $region) { $region.ToString() } else { "NULL" }

    $sql = "UPDATE wims.users SET keycloak_id = '$uuid'::uuid, username = '$username', role = '$role', assigned_region_id = $regionSql, is_active = TRUE, updated_at = now() WHERE username = '$username' OR keycloak_id = '$uuid'::uuid; INSERT INTO wims.users (user_id, keycloak_id, username, role, assigned_region_id, is_active) SELECT '$uuid'::uuid, '$uuid'::uuid, '$username', '$role', $regionSql, TRUE WHERE NOT EXISTS (SELECT 1 FROM wims.users WHERE username = '$username' OR keycloak_id = '$uuid'::uuid);"

    docker compose -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d wims -c $sql | Out-Null
}

$seededUsernames = ($users | ForEach-Object { $_.username }) -join ", "
Write-Host "Seed complete. Users: $seededUsernames"
Write-Host "Password for standard test users: $password"
Write-Host "Password for team member accounts (n-/g-/e-/r- prefix): WimsBFP2026!"
