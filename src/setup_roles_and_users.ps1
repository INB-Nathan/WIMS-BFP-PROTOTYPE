param(
    [string]$adminUser = "admin",
    [string]$adminPass = "admin"
)

Write-Host "Logging into Keycloak Admin..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user $adminUser --password $adminPass

Write-Host "Creating essential roles in Keycloak..."
$roles = @("ENCODER", "VALIDATOR", "ANALYST", "ADMIN", "SYSTEM_ADMIN")
foreach ($role in $roles) {
    docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create roles -r bfp -s name=$role 2>$null
}

function Create-User-And-Sync {
    param (
        [string]$username,
        [string]$email,
        [string]$role
    )
    
    Write-Host "`n--- Creating User: $username ($role) ---"
    
    # 1. Create User
    docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create users -r bfp -s username=$username -s enabled=true -s email=$email
    
    # 2. Set Password to 'password123'
    docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh set-password -r bfp --username $username --new-password password123
    
    # 3. Assign Role
    docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r bfp --uusername $username --rolename $role
    
    # 4. Get UUID from Keycloak
    $userJson = docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get users -r bfp -q username=$username
    $uuid = ($userJson | ConvertFrom-Json)[0].id
    
    Write-Host "Generated Keycloak UUID: $uuid"
    
    # 5. Insert into Postgres
    $sql = "INSERT INTO wims.users (user_id, keycloak_id, username, role, assigned_region_id, is_active) VALUES ('$uuid', '$uuid', '$username', '$role', 1, TRUE) ON CONFLICT (user_id) DO NOTHING;"
    
    docker compose exec postgres psql -U postgres -d wims -c $sql
    Write-Host "Synced to PostgreSQL 'wims.users' table."
}

Create-User-And-Sync -username "admin_test" -email "admin@bfp.gov.ph" -role "ADMIN"
Create-User-And-Sync -username "analyst_test" -email "analyst@bfp.gov.ph" -role "ANALYST"
Create-User-And-Sync -username "validator_test" -email "validator@bfp.gov.ph" -role "VALIDATOR"

Write-Host "`nDone! You can now log in at http://localhost with these accounts (password: password123) and access the admin/analyst pages."
